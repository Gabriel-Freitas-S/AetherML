"""
ml/run_tests.py — Executor de testes do pipeline ML.

Descobre e executa todos os scripts `test_*.py` dentro do diretório `ml/`
em subprocessos independentes. Retorna exit 0 se todos passarem ou
exit 1 se qualquer um falhar.
"""

import os
import subprocess
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent


def discover_tests() -> list[Path]:
    """Descobre e ordena deterministicamente todos os test_*.py dentro de ml/."""
    tests = sorted(ML_DIR.rglob("test_*.py"))
    return tests


def run_tests() -> int:
    tests = discover_tests()
    if not tests:
        print("[run_tests] Nenhum arquivo test_*.py encontrado em ml/", file=sys.stderr)
        return 1

    print(f"[run_tests] Encontrados {len(tests)} arquivos de teste em ml/:")
    for t in tests:
        print(f"  - {t.relative_to(ML_DIR.parent).as_posix()}")
    print("-" * 60)

    failed = []
    for test_path in tests:
        rel = test_path.relative_to(ML_DIR.parent).as_posix()
        print(f"\n[run_tests] Rodando: {rel} ...", flush=True)
        env = dict(os.environ)
        # Garante que a raiz do projeto esteja no PYTHONPATH
        env["PYTHONPATH"] = str(ML_DIR.parent) + (f"{os.pathsep}{env['PYTHONPATH']}" if "PYTHONPATH" in env else "")
        res = subprocess.run([sys.executable, str(test_path)], env=env)
        if res.returncode != 0:
            print(f"[run_tests] ❌ FALHOU: {rel} (código {res.returncode})", file=sys.stderr)
            failed.append(rel)
        else:
            print(f"[run_tests] ✔ PASSOU: {rel}")

    print("\n" + "=" * 60)
    if failed:
        print(f"[run_tests] FALHA: {len(failed)} teste(s) falharam: {', '.join(failed)}", file=sys.stderr)
        return 1

    print(f"[run_tests] SUCESSO: Todos os {len(tests)} suites de teste passaram.")
    return 0


if __name__ == "__main__":
    sys.exit(run_tests())
