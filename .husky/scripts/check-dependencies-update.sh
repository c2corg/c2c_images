#!/usr/bin/env sh

function changed {
  git diff --name-only HEAD@{1} HEAD | grep "^$1" > /dev/null 2>&1
}

if changed 'package-lock.json'; then
  echo "package-lock.json changed. Running npm install to bring your dependencies up to date."
  npm install
fi
