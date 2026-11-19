#!/usr/bin/env bash
# Retry a command a few times, for steps that fail because of the network
# rather than because the code is wrong.
#
#   source .github/workflows/retry.sh
#   retry npm install
#   retry 2 ./gradlew assembleDebug     # explicit attempt count
#
# What belongs in here: dependency downloads, package resolution, anything
# talking to a registry. What does NOT: the test suite and the compilers.
# Retrying those turns a real failure into three slow real failures and
# teaches you to ignore red builds.

retry () {
  local attempts=3
  if [[ "$1" =~ ^[0-9]+$ ]]; then attempts="$1"; shift; fi

  local n=1
  until "$@"; do
    local code=$?
    if (( n >= attempts )); then
      echo "::error::'$*' failed ${attempts} times; giving up (exit ${code})"
      return "$code"
    fi
    local wait=$(( n * 15 ))
    echo "::warning::'$*' failed (exit ${code}), attempt ${n} of ${attempts}; retrying in ${wait}s"
    sleep "$wait"
    n=$(( n + 1 ))
  done
}
