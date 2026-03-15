$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

Set-Location "c:\Users\dougl\Documents\Rogaine\Navlight-Mapper"

$frontendBaseUrl = "http://localhost:8080"
$apiBaseUrl = "$frontendBaseUrl/api"

$deadline = (Get-Date).AddMinutes(2)
$apiReady = $false
while ((Get-Date) -lt $deadline) {
  try {
    $healthProbe = Invoke-RestMethod -Uri "$apiBaseUrl/health" -Method Get -TimeoutSec 5
    if ($healthProbe.status -eq 'ok') {
      $apiReady = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $apiReady) {
  throw "API did not become ready within timeout."
}

$frontendResponse = Invoke-WebRequest -Uri $frontendBaseUrl -UseBasicParsing -TimeoutSec 20
$health = Invoke-RestMethod -Uri "$apiBaseUrl/health" -Method Get -TimeoutSec 20
$statusBefore = Invoke-RestMethod -Uri "$apiBaseUrl/sync/status" -Method Get -TimeoutSec 20

$httpClient = [System.Net.Http.HttpClient]::new()

function Invoke-SyncBatchRequest {
  param(
    [string]$Endpoint,
    [string]$MetadataJson,
    [string]$PointsJson,
    [string]$PhotosMetaJson,
    [string]$PhotoFilePath
  )

  $content = [System.Net.Http.MultipartFormDataContent]::new()
  $content.Add([System.Net.Http.StringContent]::new($MetadataJson), "metadata")
  $content.Add([System.Net.Http.StringContent]::new($PointsJson), "points")
  $content.Add([System.Net.Http.StringContent]::new($PhotosMetaJson), "photosMeta")

  if ($PhotoFilePath) {
    $bytes = [System.IO.File]::ReadAllBytes($PhotoFilePath)
    $fileContent = [System.Net.Http.ByteArrayContent]::new($bytes)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/jpeg")
    $content.Add($fileContent, "photos", [System.IO.Path]::GetFileName($PhotoFilePath))
  }

  $response = $httpClient.PostAsync($Endpoint, $content).GetAwaiter().GetResult()
  $rawBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $parsedBody = $null

  if ($rawBody -and $rawBody.Trim().Length -gt 0) {
    $parsedBody = $rawBody | ConvertFrom-Json
  }

  return [PSCustomObject]@{
    statusCode = [int]$response.StatusCode
    body = $parsedBody
    rawBody = $rawBody
  }
}

$pointBatchId = [guid]::NewGuid().ToString()
$clientId = "smoke-client"
$trackId = [guid]::NewGuid().ToString()
$pointId = [guid]::NewGuid().ToString()
$mapId = "smoke-map-1"
$recordedAt = (Get-Date).ToString("o")

$metadataPoint = @{ 
  batchId = $pointBatchId
  clientId = $clientId
  createdAt = $recordedAt
  pointCount = 1
  photoCount = 0
} | ConvertTo-Json -Compress

$pointsPayload = @(
  @{
    id = $pointId
    trackId = $trackId
    mapId = $mapId
    lat = 34.1234567
    lng = -117.1234567
    accuracy = 5.5
    recordedAt = $recordedAt
  }
)
$pointsJson = ConvertTo-Json -InputObject $pointsPayload -Compress

$pointSync = Invoke-SyncBatchRequest -Endpoint "$apiBaseUrl/sync/batch" -MetadataJson $metadataPoint -PointsJson $pointsJson -PhotosMetaJson "[]" -PhotoFilePath ""

$photoPath = Join-Path $env:TEMP "navlight-smoke.jpg"
[System.IO.File]::WriteAllBytes($photoPath, [byte[]](255, 216, 255, 217))

$photoBatchId = [guid]::NewGuid().ToString()
$photoId = [guid]::NewGuid().ToString()
$capturedAt = (Get-Date).ToString("o")

$metadataPhoto = @{
  batchId = $photoBatchId
  clientId = $clientId
  createdAt = $capturedAt
  pointCount = 0
  photoCount = 1
} | ConvertTo-Json -Compress

$photosMetaPayload = @(
  @{
    id = $photoId
    trackId = $trackId
    mapId = $mapId
    lat = 34.1234567
    lng = -117.1234567
    accuracy = 6.2
    capturedAt = $capturedAt
    mimeType = "image/jpeg"
    fileName = "navlight-smoke.jpg"
    uploadField = "photo-0"
  }
)
$photosMetaJson = ConvertTo-Json -InputObject $photosMetaPayload -Compress

$photoSync = Invoke-SyncBatchRequest -Endpoint "$apiBaseUrl/sync/batch" -MetadataJson $metadataPhoto -PointsJson "[]" -PhotosMetaJson $photosMetaJson -PhotoFilePath $photoPath

$statusAfter = Invoke-RestMethod -Uri "$apiBaseUrl/sync/status" -Method Get -TimeoutSec 20

$httpClient.Dispose()

$result = [PSCustomObject]@{
  frontendStatusCode = $frontendResponse.StatusCode
  apiHealth = $health.status
  syncStatusBefore = $statusBefore
  pointSyncResponse = $pointSync
  photoSyncResponse = $photoSync
  syncStatusAfter = $statusAfter
}

$result | ConvertTo-Json -Depth 8
