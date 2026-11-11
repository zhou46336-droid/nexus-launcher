"""把 .ico 图标和程序清单（manifest）打包成 Go 链接器能识别的 .syso（COFF 目标文件，含 .rsrc 资源段）。
用法：python3 mksyso.py icon.ico manifest.xml out.syso
格式参照 PE/COFF 规范和 akavel/rsrc 的做法。"""
import struct
import sys

RT_ICON, RT_GROUP_ICON, RT_MANIFEST = 3, 14, 24
LANG = 0x0409


def read_ico(path):
    d = open(path, 'rb').read()
    _, typ, count = struct.unpack_from('<HHH', d, 0)
    assert typ == 1, 'not an .ico'
    imgs = []
    for i in range(count):
        w, h, cc, res, planes, bpp, size, off = struct.unpack_from('<BBBBHHII', d, 6 + i * 16)
        imgs.append(dict(w=w, h=h, cc=cc, planes=planes or 1, bpp=bpp or 32, data=d[off:off + size]))
    return imgs


def build(ico_path, manifest_path):
    imgs = read_ico(ico_path)
    manifest = open(manifest_path, 'rb').read()
    grp = struct.pack('<HHH', 0, 1, len(imgs))
    for n, im in enumerate(imgs, 1):
        grp += struct.pack('<BBBBHHIH', im['w'], im['h'], im['cc'], 0, im['planes'], im['bpp'], len(im['data']), n)

    # 类型 → [(id, data)]，按 id 升序
    tree = [
        (RT_ICON, [(n, im['data']) for n, im in enumerate(imgs, 1)]),
        (RT_GROUP_ICON, [(1, grp)]),
        (RT_MANIFEST, [(1, manifest)]),
    ]

    # 先算目录区大小：根目录 + 每个类型目录 + 每个名字目录（语言层）+ 数据项
    def dir_size(n):
        return 16 + 8 * n

    off = dir_size(len(tree))
    type_dir_off = []
    for _, items in tree:
        type_dir_off.append(off)
        off += dir_size(len(items))
    lang_dir_off = []
    for _, items in tree:
        lst = []
        for _ in items:
            lst.append(off)
            off += dir_size(1)
        lang_dir_off.append(lst)
    data_entry_off = []
    for _, items in tree:
        lst = []
        for _ in items:
            lst.append(off)
            off += 16
        data_entry_off.append(lst)
    data_off = []
    for _, items in tree:
        lst = []
        for _, blob in items:
            off = (off + 7) & ~7
            lst.append(off)
            off += len(blob)
        data_off.append(lst)
    total = (off + 7) & ~7

    buf = bytearray(total)
    relocs = []

    def put_dir(at, entries):
        struct.pack_into('<IIHHHH', buf, at, 0, 0, 0, 0, 0, len(entries))
        for k, (ident, target) in enumerate(entries):
            struct.pack_into('<II', buf, at + 16 + 8 * k, ident, target)

    put_dir(0, [(t, 0x80000000 | type_dir_off[i]) for i, (t, _) in enumerate(tree)])
    for i, (_, items) in enumerate(tree):
        put_dir(type_dir_off[i], [(ident, 0x80000000 | lang_dir_off[i][j]) for j, (ident, _) in enumerate(items)])
        for j, (_, blob) in enumerate(items):
            put_dir(lang_dir_off[i][j], [(LANG, data_entry_off[i][j])])
            e = data_entry_off[i][j]
            struct.pack_into('<IIII', buf, e, data_off[i][j], len(blob), 0, 0)
            relocs.append(e)  # OffsetToData 是 RVA，需要链接时加上段地址
            buf[data_off[i][j]:data_off[i][j] + len(blob)] = blob

    # COFF：文件头 + 1 个段头 + 段数据 + 重定位表 + 符号表 + 字符串表
    hdr_size = 20 + 40
    raw_ptr = hdr_size
    reloc_ptr = raw_ptr + len(buf)
    sym_ptr = reloc_ptr + 10 * len(relocs)
    out = bytearray()
    out += struct.pack('<HHIIIHH', 0x8664, 1, 0, sym_ptr, 1, 0, 0)
    out += struct.pack('<8sIIIIIIHHI', b'.rsrc', 0, 0, len(buf), raw_ptr, reloc_ptr, 0, len(relocs), 0, 0x40000040)
    out += buf
    for r in relocs:
        out += struct.pack('<IIH', r, 0, 3)  # IMAGE_REL_AMD64_ADDR32NB
    out += struct.pack('<8sIhHBB', b'.rsrc', 0, 1, 0, 3, 0)
    out += struct.pack('<I', 4)
    return bytes(out)


if __name__ == '__main__':
    open(sys.argv[3], 'wb').write(build(sys.argv[1], sys.argv[2]))
    print('ok', sys.argv[3])
