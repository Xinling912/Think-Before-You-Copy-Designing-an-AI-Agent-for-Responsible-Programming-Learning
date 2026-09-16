from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED_FILES = [
    "Dockerfile",
    "docker/start.sh",
    "frontend/package.json",
    "frontend/src/pages/SessionDemo/index.tsx",
    "frontend/src/pages/Skills/index.tsx",
    "services/api-gateway-go/responsible.api",
    "services/api-gateway-go/etc/responsible-api.yaml",
    "services/api-gateway-go/internal/app/gateway.go",
    "services/api-gateway-go/internal/app/static.go",
    "services/api-gateway-go/internal/store/sqlite.go",
    "services/api-gateway-go/migrations/001_init.sql",
    "services/ai-core-python/app/main.py",
    "harness/cases/index-error-e2e.yaml",
    "scripts/e2e_index_error_smoke.py",
]

REQUIRED_STRINGS = {
    "services/api-gateway-go/responsible.api": [
        "/api/health",
        "/api/skills",
        "/api/kg/path",
        "/api/session/message",
        "/api/session/:id/evidence",
    ],
    "services/api-gateway-go/internal/app/static.go": [
        "GatewayNotFoundHandler",
        "AIProxyHandler",
        "FrontendHandler",
    ],
    "Dockerfile": [
        "BASE_IMAGE_REGISTRY=docker.1ms.run",
        "npm run build",
        "GOPROXY=https://goproxy.cn,direct",
        "PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple",
    ],
    "docker/start.sh": [
        "except Exception",
        "raise SystemExit(1)",
    ],
}


def main() -> None:
    missing = [path for path in REQUIRED_FILES if not (ROOT / path).exists()]
    if missing:
        raise SystemExit("Missing required files:\n" + "\n".join(missing))

    errors = []
    for path, needles in REQUIRED_STRINGS.items():
        text = (ROOT / path).read_text(encoding="utf-8")
        for needle in needles:
            if needle not in text:
                errors.append(f"{path}: missing {needle}")

    if errors:
        raise SystemExit("Service contract check failed:\n" + "\n".join(errors))

    print("Service contract checks passed.")


if __name__ == "__main__":
    main()
