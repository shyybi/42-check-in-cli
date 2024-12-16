#!/bin/bash
run_script() {
  while true; do
    node src/main.js
    if [ $? -ne 0 ]; then
      echo "Script crashed with exit code $?. Restarting..." >&2
      sleep 5 
    else
      break
    fi
  done
}
run_script