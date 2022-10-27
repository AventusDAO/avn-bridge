#!/bin/bash

clear
ETH_truffleNetwork="development"

if [ "$1" == "bin-check" ]; then
  truffle compile
  node tools/binariesCheck.js
  exit $?
fi

if [ "$1" == "coverage" ]; then
  rm -rf build
  rm -rf coverage
  touch allFiredEvents
  truffle run coverage --network development
  exit $?
fi

if [ "$1" == "deploy-goerli" ]; then
  ETH_truffleNetwork="goerli"
fi

if [ "$1" == "deploy-mainnet" ]; then
  # ETH_truffleNetwork="mainnet"
  :
fi

echo "** Using truffle network $ETH_truffleNetwork"
rm -rf build
truffle compile

if [ "$1" == "deploy-goerli" ]; then
  export migrationLog=migrationLog-$ETH_truffleNetwork.txt
  echo "** Deploying to Goerli..."
  date > $migrationLog
  truffle migrate --network $ETH_truffleNetwork --skip-dry-run --reset | tee -a $migrationLog
  echo "** Publishing contracts... ***"
  sleep 10
  npx truffle run verify AVN --network goerli | tee -a $migrationLog
  date >> $migrationLog
  exit $?
fi

if [ "$1" == "deploy-mainnet" ]; then
  # export migrationLog=migrationLog-$ETH_truffleNetwork.txt
  # echo "** Deploying to Mainnet..."
  # date > $migrationLog
  # truffle migrate --network $ETH_truffleNetwork --skip-dry-run --reset | tee -a $migrationLog
  # echo "** Publishing contracts... ***"
  # sleep 10
  # npx truffle run verify AVN --network mainnet | tee -a $migrationLog
  # date >> $migrationLog
  exit $?
fi

if [ "$?" != "0" ]; then exit $?; fi

echo "** Starting new ganache"
ganache_command=(ganache-cli --accounts=30 --acctKeys keys.json -l 10000000 -m "lady sad two vacuum rail siren barrel convince rare helmet wagon approve" -h 0.0.0.0 ${GANACHE_ADDITIONAL_ARGUMENTS})

if [ "${RUN_GANACHE_IN_BACKGROUND:-off}" == "on" ]; then
"${ganache_command[@]}" > ganache.log 2>&1 &
else
gnome-terminal -- "${ganache_command[@]}"
fi

if [ "$1" == "test" ]; then
  truffle compile
  truffle test --network $ETH_truffleNetwork $2
  exit $?
fi

if [ "$1" == "deploy-dev" ]; then
  echo "** Deploying to Local network..."
  truffle build
  truffle migrate --network $ETH_truffleNetwork --reset
  exit $?
fi

export migrationLog=migrationLog-$ETH_truffleNetwork.txt
echo "** Migrating"
date > $migrationLog
truffle migrate --network $ETH_truffleNetwork --reset | tee -a $migrationLog
date >> $migrationLog

exit $?