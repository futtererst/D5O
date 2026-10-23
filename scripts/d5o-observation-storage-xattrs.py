import base64
import hashlib
import json
import os
import sys

ROOT = "/mnt/stub/stub"
XATTRS = "/tmp/d5o-observation-xattrs.json"
FILES = "/tmp/d5o-observation-file-manifest.json"
if sys.argv[1:] != ["restore"]:
    raise SystemExit("restore_only")
root = os.path.realpath(ROOT)
if root != ROOT or not os.path.isdir(root):
    raise SystemExit("unexpected_storage_root")
with open(FILES, encoding="utf-8") as source:
    expected = json.load(source)
with open(XATTRS, encoding="utf-8") as source:
    attrs = json.load(source)
def checked(relative):
    path = os.path.realpath(os.path.join(root, relative))
    if os.path.commonpath([root, path]) != root:
        raise RuntimeError("outside_storage_root:" + relative)
    return path
for directory, _, names in os.walk(root):
    for name in names:
        path = os.path.join(directory, name)
        relative = os.path.relpath(path, root).replace(os.sep, "/")
        checked(relative)
        if os.path.islink(path):
            raise RuntimeError("unexpected_symlink:" + relative)
        if relative not in expected:
            os.remove(path)
for relative, digest in expected.items():
    path = checked(relative)
    if not os.path.isfile(path):
        raise RuntimeError("missing_object:" + relative)
    with open(path, "rb") as source:
        if hashlib.sha256(source.read()).hexdigest() != digest:
            raise RuntimeError("object_checksum_mismatch:" + relative)
for relative, values in attrs.items():
    path = checked(relative)
    if not os.path.exists(path):
        raise RuntimeError("missing_attribute_target:" + relative)
    for key, encoded in values.items():
        os.setxattr(path, key, base64.b64decode(encoded))
print("restored_private_files=" + str(len(expected)) + " xattr_entries=" + str(len(attrs)))