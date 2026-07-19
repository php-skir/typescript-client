#!/usr/bin/env bash

set -euo pipefail

badge_path=$1
repository=$GITHUB_REPOSITORY
badge_endpoint="repos/$repository/contents/coverage.svg"
workflow_sha=${GITHUB_SHA:?GITHUB_SHA must identify the tested main commit}
latest_main_sha=$(gh api "repos/$repository/git/ref/heads/main" --jq '.object.sha')

if [[ "$workflow_sha" != "$latest_main_sha" ]]; then
    echo "Skipping coverage badge from stale main commit $workflow_sha."
    exit 0
fi

if ! gh api "repos/$repository/git/ref/heads/badges" > /dev/null 2>&1; then
    gh api \
        --method POST \
        "repos/$repository/git/refs" \
        -f ref='refs/heads/badges' \
        -f sha="$latest_main_sha" \
        > /dev/null
fi

badge_content=$(base64 < "$badge_path" | tr -d '\n')
existing_content=$(gh api "$badge_endpoint?ref=badges" --jq '.content' 2> /dev/null | tr -d '\n' || true)

if [[ "$existing_content" == "$badge_content" ]]; then
    exit 0
fi

existing_sha=$(gh api "$badge_endpoint?ref=badges" --jq '.sha' 2> /dev/null || true)

if [[ -n "$existing_sha" ]]; then
    gh api \
        --method PUT \
        "$badge_endpoint" \
        -f message='Update coverage badge' \
        -f content="$badge_content" \
        -f branch='badges' \
        -f sha="$existing_sha" \
        > /dev/null

    exit 0
fi

gh api \
    --method PUT \
    "$badge_endpoint" \
    -f message='Add coverage badge' \
    -f content="$badge_content" \
    -f branch='badges' \
    > /dev/null
