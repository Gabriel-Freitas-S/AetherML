"""
ml/training/upload_r2.py — Publica os artefatos de modelos no R2 e o manifesto lido pelo Worker.

Esquema de chaves: artefatos versionados em `models/{active_version}/{arquivo}` e um
ponteiro unico na raiz, `manifest.json`, que e a chave lida em workers/api/src/index.ts.
Um retreino muda `active_version`, grava um prefixo novo e o release antigo permanece.

Uso:
    python -m ml.training.upload_r2 upload            # publica e imprime chave + bytes
    python -m ml.training.upload_r2 verify            # rebaixa cada chave e confere o tamanho
    python -m ml.training.upload_r2 upload v2026.38.6 # forca a versao (default: active_version)
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from typing import Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS_DIR = os.path.join(REPO_ROOT, "apps", "web", "public", "models")
REGISTRY_FILE = os.path.join(MODELS_DIR, "registry.json")
BUCKET = "aetherml-models"
MANIFEST_KEY = "manifest.json"

ARTIFACT_CONTENT_TYPES = {
    "onnx": "application/octet-stream",
    "json": "application/json",
}
# Artefatos versionados sao imutaveis por hash (specs/06-pwa-offline.md:10).
ARTIFACT_CACHE_CONTROL = "public, max-age=31536000, immutable"
MANIFEST_CACHE_CONTROL = "public, max-age=300"


def _wrangler() -> str:
    """Resolve o executavel do wrangler (npx.cmd no Windows) sem depender do shell."""
    exe = shutil.which("npx")
    if exe is None:
        raise SystemExit("[AetherML ML] 'npx' nao encontrado no PATH.")
    return exe


def _run(args: List[str]) -> None:
    result = subprocess.run(
        [_wrangler(), "wrangler", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise SystemExit(
            f"[AetherML ML] Falha em 'wrangler {' '.join(args)}':\n{result.stderr or result.stdout}"
        )


def load_registry() -> Dict:
    with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def build_manifest(registry: Dict, version: str) -> Dict:
    """
    O Worker devolve `await obj.json()` sem validar nada e o cliente web le apenas
    `active_version` (apps/web/src/workers/inference.worker.ts:102). Portanto o
    manifesto preserva o payload de registry.py sem alteracao e acrescenta apenas
    `models_base`, que torna o prefixo versionado descobvivel pelo consumidor.
    """
    manifest = dict(registry)
    manifest["models_base"] = f"models/{version}/"
    return manifest


def artifact_plan(version: str) -> List[Tuple[str, str]]:
    """(chave R2, caminho local) para cada artefato a publicar."""
    prefix = f"models/{version}/"
    plan = []
    for name in sorted(os.listdir(MODELS_DIR)):
        if (
            name.endswith(".onnx")
            or name.endswith(".topology.json")
            or name == "calibration.json"
        ):
            plan.append((prefix + name, os.path.join(MODELS_DIR, name)))
    plan.append((prefix + "registry.json", REGISTRY_FILE))
    return plan


def content_type_for(key: str) -> str:
    return ARTIFACT_CONTENT_TYPES["onnx" if key.endswith(".onnx") else "json"]


def upload(version: Optional[str] = None) -> None:
    registry = load_registry()
    version = version or registry["active_version"]

    print("=" * 70)
    print(f"[AetherML ML] Upload R2 -> bucket '{BUCKET}', versao '{version}'")
    print("=" * 70)

    uploads = artifact_plan(version)
    uploads.append((MANIFEST_KEY, None))  # gerado em memoria

    total = 0
    for key, path in uploads:
        if path is None:
            payload = json.dumps(build_manifest(registry, version), indent=2)
            content_type = "application/json"
            cache_control = MANIFEST_CACHE_CONTROL
        else:
            with open(path, "rb") as f:
                payload = f.read()
            content_type = content_type_for(key)
            cache_control = ARTIFACT_CACHE_CONTROL

        blob = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        size = len(blob)
        tmp = os.path.join(tempfile.gettempdir(), "aetherml-upload.tmp")
        with open(tmp, "wb") as f:
            f.write(blob)

        _run(
            [
                "r2",
                "object",
                "put",
                f"{BUCKET}/{key}",
                "--file",
                tmp,
                "--content-type",
                content_type,
                "--cache-control",
                cache_control,
                "--remote",
            ]
        )
        total += size
        print(f"  OK  {key:<48} {size:>9} bytes")

    if os.path.exists(os.path.join(tempfile.gettempdir(), "aetherml-upload.tmp")):
        os.remove(os.path.join(tempfile.gettempdir(), "aetherml-upload.tmp"))

    print("=" * 70)
    print(f"[AetherML ML] {len(uploads)} objetos publicados, {total} bytes no total.")
    print("=" * 70)


def verify(version: Optional[str] = None) -> None:
    """`wrangler r2 object` em 4.125.0 expoe apenas get/put/delete (sem list),
    entao a listagem e feita baixando cada chave esperada e conferindo o tamanho."""
    registry = load_registry()
    version = version or registry["active_version"]

    keys = [key for key, _ in artifact_plan(version)] + [MANIFEST_KEY]
    print("=" * 70)
    print(f"[AetherML ML] Verificacao R2 -> bucket '{BUCKET}', versao '{version}'")
    print("=" * 70)

    missing = []
    for key in keys:
        tmp = os.path.join(tempfile.gettempdir(), "aetherml-verify.tmp")
        _run(["r2", "object", "get", f"{BUCKET}/{key}", "--file", tmp, "--remote"])
        size = os.path.getsize(tmp)
        os.remove(tmp)
        if size == 0:
            missing.append(key)
            print(f"  FALHA  {key:<48} {size:>9} bytes")
        else:
            print(f"  OK      {key:<48} {size:>9} bytes")

    print("=" * 70)
    if missing:
        print(
            f"[AetherML ML] {len(missing)} chave(s) ausente(s) ou vazia(s): {missing}"
        )
        raise SystemExit(1)
    print(f"[AetherML ML] {len(keys)} chaves confirmadas com tamanho > 0.")
    print("=" * 70)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "upload"
    forced_version = sys.argv[2] if len(sys.argv) > 2 else None
    if mode == "upload":
        upload(forced_version)
    elif mode == "verify":
        verify(forced_version)
    else:
        raise SystemExit(
            f"[AetherML ML] Modo desconhecido: {mode!r} (use 'upload' ou 'verify')."
        )
