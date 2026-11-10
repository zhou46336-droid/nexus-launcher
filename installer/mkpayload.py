"""把程序目录压缩成安装程序内嵌的 payload.zip。用法：python3 mkpayload.py <程序目录> <输出 zip>"""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for name in sorted(files):
            p = os.path.join(root, name)
            z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
print('payload', out, os.path.getsize(out) // (1024 * 1024), 'MB')
