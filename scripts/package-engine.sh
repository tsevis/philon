#!/bin/zsh
set -euo pipefail

ROOT_DIR="${0:A:h:h}"
PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Create the project virtual environment first: python3 -m venv .venv" >&2
  exit 1
fi

"${PYTHON_BIN}" -m pip install --requirement "${ROOT_DIR}/engine/requirements-build.txt"
"${PYTHON_BIN}" -m PyInstaller --noconfirm --clean --onefile --name philon-engine \
  --distpath "${ROOT_DIR}/engine/dist" \
  --workpath "${ROOT_DIR}/engine/build" \
  --specpath "${ROOT_DIR}/engine" \
  --add-data "${ROOT_DIR}/engine/model-manifest.json:." \
  --collect-all pypdfium2 --collect-all pypdf --collect-all PIL \
  "${ROOT_DIR}/engine/philon_engine.py"
swiftc -O -framework Vision -framework AppKit "${ROOT_DIR}/engine/vision_ocr.swift" -o "${ROOT_DIR}/engine/dist/philon-vision-ocr"
codesign --force --sign - "${ROOT_DIR}/engine/dist/philon-engine"
codesign --force --sign - "${ROOT_DIR}/engine/dist/philon-vision-ocr"
