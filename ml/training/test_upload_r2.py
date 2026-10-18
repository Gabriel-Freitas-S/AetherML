"""
ml/training/test_upload_r2.py — Testes do resolvedor de wrangler e do argv do upload R2.

Regressões cobertas:
- run 39172584159: `_wrangler()` resolvia `npx` puro e `_run()` executava
  `npx wrangler` (sem -y, sem versão) -> "sh: 1: wrangler: not found" no runner.
- revisão do fix: o wrangler do workspace é v3 (`workers/*` pina ^3.78.0) e não
  aceita `--remote`; o resolver deve ignorá-lo e usar somente v4 (PATH/npx).
- contrato do `_run()`: prefixo resolvido + args repassados (inclui `--remote`).

Roda: `python ml/training/test_upload_r2.py` (exit 0 = verde).
"""

import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from ml.training import upload_r2

MARKER = "[AetherML ML]"


class _Which:
    def __init__(self, mapping):
        self.mapping = mapping

    def __call__(self, name):
        return self.mapping.get(name)


def _patch_which(which_map, repo_root=None):
    original = (upload_r2.REPO_ROOT, upload_r2.shutil)
    if repo_root is not None:
        upload_r2.REPO_ROOT = repo_root
    upload_r2.shutil = types.SimpleNamespace(which=_Which(which_map))
    return original


def _restore(original):
    upload_r2.REPO_ROOT, upload_r2.shutil = original


def test_wrangler_ignora_binario_v3_do_workspace():
    """Regressão C1 da revisão: mesmo com `workers/api/node_modules/.bin/wrangler`
    presente, o resolver NÃO pode devolvê-lo (v3 rejeita `--remote`)."""
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = os.path.join(tmp, "workers", "api", "node_modules", ".bin")
        os.makedirs(bin_dir)
        decoy = os.path.join(bin_dir, "wrangler")
        with open(decoy, "w") as f:
            f.write("#!/bin/sh\nexit 1\n")
        original = _patch_which({"npx": "/usr/bin/npx"}, repo_root=tmp)
        try:
            cmd = upload_r2._wrangler()
            assert cmd == ["/usr/bin/npx", "-y", "wrangler@4"], cmd
            assert decoy not in cmd, cmd
        finally:
            _restore(original)


def test_wrangler_prefere_binario_do_path():
    original = _patch_which(
        {"wrangler": "/usr/local/bin/wrangler", "npx": "/usr/bin/npx"}
    )
    try:
        cmd = upload_r2._wrangler()
        assert cmd == ["/usr/local/bin/wrangler"], cmd
    finally:
        _restore(original)


def test_wrangler_fallback_npx_com_versao_pinada():
    original = _patch_which({"npx": "/usr/bin/npx"})
    try:
        cmd = upload_r2._wrangler()
        assert cmd == ["/usr/bin/npx", "-y", "wrangler@4"], cmd
    finally:
        _restore(original)


def test_wrangler_sem_wrangler_nem_npx_aborta():
    original = _patch_which({})
    try:
        try:
            upload_r2._wrangler()
        except SystemExit as exc:
            message = str(exc)
            assert MARKER in message, message
            assert "npx" in message and "wrangler" in message, message
        else:
            raise AssertionError("esperava SystemExit sem npx/wrangler")
    finally:
        _restore(original)


def test_run_monta_argv_com_prefixo_resolvido_e_remote():
    """Contrato do _run(): prefixo do resolver + args repassados, com `--remote`
    (flag v4 que upload()/verify() exigem)."""
    captured = {}

    class _Result:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return _Result()

    with tempfile.TemporaryDirectory() as tmp:
        original = _patch_which({"npx": "/usr/bin/npx"}, repo_root=tmp)
        old_subprocess = upload_r2.subprocess
        upload_r2.subprocess = types.SimpleNamespace(run=fake_run)
        try:
            upload_r2._run(
                [
                    "r2",
                    "object",
                    "get",
                    "aetherml-models/pm25.onnx",
                    "--file",
                    "/tmp/f",
                    "--remote",
                ]
            )
        finally:
            upload_r2.subprocess = old_subprocess
            _restore(original)

        expected = [
            "/usr/bin/npx",
            "-y",
            "wrangler@4",
            "r2",
            "object",
            "get",
            "aetherml-models/pm25.onnx",
            "--file",
            "/tmp/f",
            "--remote",
        ]
        assert captured["cmd"] == expected, captured["cmd"]
        assert captured["kwargs"].get("cwd") == tmp, captured["kwargs"]


if __name__ == "__main__":
    test_wrangler_ignora_binario_v3_do_workspace()
    test_wrangler_prefere_binario_do_path()
    test_wrangler_fallback_npx_com_versao_pinada()
    test_wrangler_sem_wrangler_nem_npx_aborta()
    test_run_monta_argv_com_prefixo_resolvido_e_remote()
    print("[OK] test_upload_r2: 5/5 verdes")
