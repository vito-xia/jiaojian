# Find the newest lark-cli.exe from Doubao sandbox
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$publishArguments = @($args)
$publishExitCode = 1

try {
    $publishScript = Join-Path $PSScriptRoot 'publish_feishu.py'
    if (-not (Test-Path -LiteralPath $publishScript -PathType Leaf)) {
        throw "Publish script not found: $publishScript"
    }
    $publishPython = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $publishPythonArguments = @()
    if (-not $publishPython) {
        $publishPython = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $publishPythonArguments = @('-3')
    }
    if (-not $publishPython) { throw 'Python 3 was not found. Install Python and add it to PATH.' }
    & $publishPython.Source @publishPythonArguments -B -X utf8 -u $publishScript @publishArguments
    $publishExitCode = $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("[FAIL] " + $_.Exception.Message)
}
exit $publishExitCode
