#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
publisher="$script_dir/publish-coverage-badge.sh"
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT

badge_path="$test_dir/coverage.svg"
mock_log="$test_dir/gh.log"
printf '<svg>coverage</svg>' > "$badge_path"
: > "$mock_log"

gh() {
    local arguments="$*"

    if [[ "$arguments" == *'git/ref/heads/main'* ]]; then
        printf '%s\n' "$MOCK_MAIN_SHA"
        return 0
    fi

    if [[ "$arguments" == *'git/ref/heads/badges'* ]]; then
        return 0
    fi

    if [[ "$arguments" == *'--method PUT'* ]]; then
        printf '%s\n' "$arguments" >> "$MOCK_GH_LOG"
        return 0
    fi

    if [[ "$arguments" == *'contents/coverage.svg'* ]]; then
        return 1
    fi

    return 1
}

export -f gh
export GITHUB_REPOSITORY='php-skir/typescript-client'
export MOCK_GH_LOG="$mock_log"

export GITHUB_SHA='older-main-sha'
export MOCK_MAIN_SHA='latest-main-sha'
bash "$publisher" "$badge_path"

if [[ -s "$mock_log" ]]; then
    echo 'A stale workflow run attempted to mutate the badge branch.' >&2
    exit 1
fi

export GITHUB_SHA='latest-main-sha'
bash "$publisher" "$badge_path"

if [[ $(wc -l < "$mock_log") -ne 1 ]]; then
    echo 'The latest main workflow run did not publish the badge exactly once.' >&2
    exit 1
fi
