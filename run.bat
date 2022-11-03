@echo off
cls

set SKIP_REVERT_ERR=0

if "%1" == "coverage" goto coverage

echo ***  Check if geth node is RUNNING... ***
Tasklist /FI "IMAGENAME eq geth.exe" 2>NUL | find /I /N "geth.exe">NUL
if "%ERRORLEVEL%"=="0" goto start-deploy

echo ***  Check if Ganache UI is RUNNING... ***
Tasklist /FI "IMAGENAME eq Ganache.exe" 2>NUL | find /I /N "Ganache.exe">NUL
if "%ERRORLEVEL%"=="0" goto start-deploy

echo ***  Check if Ganache-Cli Process is RUNNING ***
TaskList /FI "IMAGENAME eq cmd.exe" /V 2>NUL | find /I /N "Ganache-Cli">NUL
if "%ERRORLEVEL%"=="0" goto start-deploy

echo ***  Start Ganache-Cli Process ***
cmd /c START /min "Ganache-Cli" ganache-cli --accounts=30 --acctKeys keys.json -l 10000000 -m "lady sad two vacuum rail siren barrel convince rare helmet wagon approve"
if %ERRORLEVEL% neq 0 goto end

:start-deploy

echo ***  Starting initial contract deployment... ***
call del /s/q build
if "%1" == "bin-check" goto bin-check
if "%1" == "test" goto truffle-test
if "%1" == "deploy-dev" goto deploy-dev
if "%1" == "deploy-goerli" goto deploy-goerli
if "%1" == "deploy-mainnet" goto deploy-mainnet
goto end

:bin-check
call truffle.cmd compile
call node tools\binariesCheck.js
goto end

:coverage
echo *** Running coverage... ***
del /F/Q coverage
del /F/Q build
copy nul /Y "allFiredEvents"
call truffle.cmd run coverage --network development
goto end

:truffle-test
echo *** Running tests using truffle network development... ***
call truffle.cmd test --network development %2
goto end

:deploy-goerli
echo *** Deploying to Goerli... ***
call truffle.cmd migrate --skip-dry-run --network goerli --reset
echo *** Publishing contract... ***
set /p IMPLEMENTATION=<implementationAddress.txt
timeout 10 > NUL
call npx truffle run verify %IMPLEMENTATION% --network goerli --license MIT
call npx truffle run verify Unlocker --network goerli --license MIT
goto end

:deploy-dev
echo *** Deploying to Local network... ***
call truffle.cmd build
call truffle.cmd migrate --network development --reset
goto end

:deploy-mainnet
REM echo *** Deploying to Mainnet... ***
REM call truffle.cmd migrate --skip-dry-run --network mainnet --reset
REM echo *** Publishing contract... ***
set /p IMPLEMENTATION=<implementationAddress.txt
REM timeout 10 > NUL
REM call npx truffle run verify @%IMPLEMENTATION% --network mainnet --license MIT
REM call npx truffle run verify Unlocker --network mainnet --license MIT
goto end

:end
echo *** ...done. ***