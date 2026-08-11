# ============================================================
# Sincronizare manuala - ruleaza toate cele 6 loturi automat
# ============================================================
# Cum se foloseste:
#   .\sincronizare-manuala.ps1
#       -> ruleaza normal (avanseaza la meciuri noi)
#
#   .\sincronizare-manuala.ps1 -Force
#       -> reface si meciurile deja analizate
#
#   .\sincronizare-manuala.ps1 -Data "2023-04-15"
#       -> mod de test, pe o singura data istorica
# ============================================================

param(
    [switch]$Force,
    [string]$Data = ""
)

$CronSecret = "Marcelo11@"
$BaseUrl = "https://fotbal-analytics.vercel.app/api/sync"
$Headers = @{ Authorization = "Bearer $CronSecret" }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Sincronizare fotbal-analytics" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if ($Data -ne "") {
    Write-Host "Mod: TEST pe data $Data" -ForegroundColor Yellow
} else {
    Write-Host "Mod: NORMAL (azi + urmatoarele 7 zile)" -ForegroundColor Yellow
}
if ($Force) {
    Write-Host "Force: DA - reface si meciurile deja analizate" -ForegroundColor Yellow
} else {
    Write-Host "Force: NU - avanseaza doar la meciuri noi" -ForegroundColor Yellow
}
Write-Host ""

$totalProcessed = 0
$totalWithAnalysis = 0

for ($batch = 0; $batch -le 2; $batch++) {

    $url = "$BaseUrl`?batch=$batch"
    if ($Data -ne "") {
        $url += "&date=$Data"
    }
    if ($Force) {
        $url += "&force=true"
    }

    Write-Host "--- Lot $batch ---" -ForegroundColor Green
    Write-Host "Rulez: $url"

    try {
        # Timeout marit la 280s, ca sa incapa serverul care acum poate
        # rula pana la 300s (Fluid Compute activat)
        $result = Invoke-RestMethod -Uri $url -Headers $Headers -TimeoutSec 280

        $processed = $result.processed
        $withAnalysis = $result.withAnalysis
        $elapsed = $result.elapsedMs
        $eligible = $result.candidatesEligible
        $alreadyDone = $result.candidatesAlreadyAnalyzed
        $remaining = $result.candidatesRemainingAfterThisRun
        $errorCount = $result.apiErrors.Count

        Write-Host ("  Gasite: {0} | Eligibile (in primele 3 zile): {1} | Deja facute inainte: {2} | Analizate ACUM: {3}" -f $processed, $eligible, $alreadyDone, $withAnalysis)
        Write-Host ("  Durata: {0}ms | Ramase dupa aceasta rulare: {1} | Erori: {2}" -f $elapsed, $remaining, $errorCount)
        Write-Host ("  Motiv oprire: {0}" -f $result.phase2StopReason) -ForegroundColor Magenta

        if ($errorCount -gt 0) {
            Write-Host "  Erori intalnite:" -ForegroundColor Red
            foreach ($err in $result.apiErrors) {
                Write-Host ("    - {0}: {1}" -f $err.context, $err.message) -ForegroundColor Red
            }
        }

        $totalProcessed += $processed
        $totalWithAnalysis += $withAnalysis

    } catch {
        Write-Host "  EROARE la acest lot: $($_.Exception.Message)" -ForegroundColor Red
    }

    Write-Host ""

    if ($batch -lt 2) {
        Start-Sleep -Seconds 3
    }
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Gata! Total meciuri gasite: $totalProcessed | Total analizate: $totalWithAnalysis" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
