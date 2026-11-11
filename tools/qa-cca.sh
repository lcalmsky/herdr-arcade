#!/bin/sh
# qa-stage fake cca: answers only the porcelain the accounts mod reads, with three fixed accounts.
# The stage copies this over <home>/mods/arcade-accounts/cca and keeps the real one as cca.orig.
set -eu

usage() {
  echo "usage: cca --porcelain [key]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
case "$1" in
  --porcelain)
    [ $# -le 2 ] || usage
    ;;
  *)
    echo "qa-stage fake cca: only --porcelain is answered" >&2
    exit 2
    ;;
esac

now=$(date +%s)
five=$((now + 7200))
week=$((now + 432000))
fable=$((now + 518400))

printf 'C\twork\n'
printf 'D\twork\n'
printf 'A\twork\twork@example.com\n'
printf 'A\tpersonal\tpersonal@example.com\n'
printf 'A\tCodex\tcodex@example.com\n'
printf 'U\twork\t21\t%s\t79\t%s\t5\t%s\n' "$five" "$week" "$fable"
printf 'U\tpersonal\t12\t%s\t34\t%s\n' "$five" "$week"
printf 'U\tCodex\t0\t%s\t11\t%s\n' "$five" "$week"
printf 'P\twork\tMax Ultra\n'
printf 'P\tpersonal\tMax\n'
printf 'P\tCodex\tPro\n'
