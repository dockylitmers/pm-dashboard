#!/usr/bin/env bash
# 개발용 설치: 이 저장소의 스킬을 ~/.claude/skills/pm에 링크하고, 터미널에서 쓸 pm 명령을 만든다.
# 플러그인으로 설치했다면(/plugin install) 이 스크립트는 필요 없다. 둘 다 하면 스킬이 두 번 보인다.
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
skill_dir="$repo/skills/pm"
skills_home="${CLAUDE_SKILLS_HOME:-$HOME/.claude/skills}"
bin_dir="${PM_BIN_DIR:-$HOME/.local/bin}"

command -v node >/dev/null || { echo "Node 18 이상이 필요합니다." >&2; exit 1; }

mkdir -p "$skills_home" "$bin_dir"
if [ -e "$skills_home/pm" ] && [ ! -L "$skills_home/pm" ]; then
  echo "$skills_home/pm 이 이미 있고 링크가 아닙니다. 확인 후 지우고 다시 실행하세요." >&2
  exit 1
fi
ln -sfn "$skill_dir" "$skills_home/pm"
echo "스킬: $skills_home/pm -> $skill_dir"

cat > "$bin_dir/pm" <<SH
#!/usr/bin/env bash
exec node "$skill_dir/scripts/pm.mjs" "\$@"
SH
chmod +x "$bin_dir/pm"
echo "명령: $bin_dir/pm"
case ":$PATH:" in *":$bin_dir:"*) ;; *) echo "PATH에 $bin_dir 를 추가하세요." ;; esac
echo "확인: pm help"
