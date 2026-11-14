#!/bin/sh
# Capsule sends the thread's facts as JSON on stdin; this line only needs git.
cat > /dev/null
case "$CAPSULE_USER_CONFIG_COLOR" in
  cyan) code=36 ;;
  yellow) code=33 ;;
  *) code=32 ;;
esac
branch=$(git branch --show-current 2>/dev/null)
changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
printf '\033[1m%s\033[0m \033[%sm⎇ %s\033[0m \033[2m·\033[0m %s changed\n' "${CAPSULE_USER_CONFIG_LABEL:-dev}" "$code" "${branch:-detached}" "${changes:-0}"
