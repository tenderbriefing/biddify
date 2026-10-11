#!/usr/bin/env bash
# Lightweight secret scan for Phase gates. Fail on likely credential leaks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0

echo "Secret scan: checking tracked/untracked source (excluding node_modules, .git, .next)…"

# Patterns that should never appear in committed source
PATTERNS=(
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY'
  'AKIA[0-9A-Z]{16}'
  'ghp_[A-Za-z0-9]{20,}'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'client_secret\s*=\s*['\''"][^'\''"]{8,}'
)

# Ensure .env is not staged/tracked
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "FAIL: .env is tracked by git"
  FAIL=1
fi

if [[ -f .env ]] && git check-ignore -q .env; then
  echo "OK: .env is gitignored"
else
  if [[ -f .env ]]; then
    echo "FAIL: .env exists but is not ignored"
    FAIL=1
  fi
fi

if [[ ! -f .env.example ]]; then
  echo "FAIL: .env.example missing"
  FAIL=1
else
  echo "OK: .env.example present"
fi

# Scan text files for high-risk patterns (skip binary/deps)
while IFS= read -r -d '' file; do
  for pattern in "${PATTERNS[@]}"; do
    if grep -EIq "$pattern" "$file" 2>/dev/null; then
      echo "FAIL: pattern matched in $file ($pattern)"
      FAIL=1
    fi
  done
done < <(find . \
  \( -path ./node_modules -o -path ./.git -o -path ./.next -o -path ./coverage -o -path ./prisma/dev.db \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' -o -name '*.md' -o -name '*.env*' -o -name '*.yml' -o -name '*.yaml' -o -name '*.sh' -o -name '*.prisma' \) -print0)

# Demo password string is allowed only in seed/docs — warn if in unexpected places
if grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
  'demo-password-change-me' . \
  | grep -Ev '(prisma/seed\.ts|README\.md|src/app/login/|scripts/secret-scan\.sh)' >/dev/null 2>&1; then
  echo "WARN: demo password string found outside expected demo files"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "Secret scan FAILED"
  exit 1
fi

echo "Secret scan PASSED"
exit 0
