$body = @'
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "5511999999999",
              "phone_number_id": "TEST_PHONE_NUMBER_ID"
            },
            "contacts": [
              {
                "profile": { "name": "Cliente Teste" },
                "wa_id": "5511987654321"
              }
            ],
            "messages": [
              {
                "from": "5511987654321",
                "id": "wamid.TESTE_ID_001",
                "timestamp": "1716304800",
                "text": { "body": "Olá, testando o log da automação!" },
                "type": "text",
                "context": {
                  "from": "5511999999999",
                  "id": "wamid.PREVIOUS_001"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
'@

try {
  $r = Invoke-WebRequest -Uri "http://localhost:3001/api/webhooks/meta/eduit" `
    -Method POST -ContentType "application/json" -Body $body `
    -UseBasicParsing -TimeoutSec 30
  Write-Host "HTTP $($r.StatusCode): $($r.Content)"
} catch {
  Write-Host "ERROR: $_"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host "BODY: $($reader.ReadToEnd())"
  }
}
