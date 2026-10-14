# Player 2
Galleria privata per un matrimonio nerd, progettata per telefono. Node.js 22 senza dipendenze, frontend HTML/CSS/JS, Google Drive privato come archivio. Il link NFC fisso scambia una chiave casuale con un cookie HttpOnly di 30 giorni; interfaccia, risorse, elenco e download richiedono il cookie. Revocare ACCESS_TOKEN invalida anche le sessioni esistenti.

## Avvio
Copia `.env.example` in `.env`, genera tre segreti distinti con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, poi `node --env-file=.env server.mjs`. Per una preview vuota senza Drive imposta `DEMO_MODE=true`. Apri `/accesso/ACCESS_TOKEN`. Non salvare segreti in Git. Test: `node --test`.

## Google Drive personale
1. Crea un progetto in Google Cloud e abilita Google Drive API.
2. Configura Google Auth Platform: nome Player 2, pubblico esterno, il tuo account come utente di prova durante la configurazione.
3. Crea un client OAuth di tipo Applicazione web, con redirect esatto `https://player2.naminiel.art/oauth/callback`.
4. Inserisci client ID e client secret nella `.env` del server e ricrea il servizio.
5. Apri privatamente `https://player2.naminiel.art/admin/connect?key=ADMIN_TOKEN` e autorizza con l'account proprietario della cartella. Il refresh token viene salvato nel volume privato con permessi 0600.
6. Passa il consenso OAuth da Testing a In production prima dell'uso duraturo: con gli scope Drive, i refresh token in Testing scadono dopo 7 giorni. Google può mostrare un avviso di app non verificata; questo collegamento è solo del proprietario, non degli invitati.

Per leggere anche le foto aggiunte direttamente dal proprietario alla cartella esistente serve lo scope `drive`. Questo consenso Google è più ampio della cartella; il backend limita tutte le operazioni all'ID configurato e verifica il parent prima di ogni download. `drive.file` non concede automaticamente accesso a tutti i file esistenti di una cartella. Non rendere la cartella pubblica.

Fonti: https://developers.google.com/workspace/drive/api/guides/api-specific-auth e https://developers.google.com/identity/protocols/oauth2/.

## VPS
`docker compose up -d --build`. Il servizio non espone porte pubbliche e usa la rete esterna `public-edge`. Nel Caddy esistente aggiungi:

```caddy
player2.naminiel.art {
    encode zstd gzip
    request_body {
        max_size 26MB
    }
    reverse_proxy player2:3000
}
```

DNS: record A `player2` verso `217.160.191.251`. Non aggiungere un record AAAA senza verificare IPv6. Valida Caddy e ricaricalo. Il link da scrivere sul chip è `https://player2.naminiel.art/accesso/ACCESS_TOKEN`. Non pubblicarlo nella repo. Il link amministratore deve restare separato.

## Limiti
25 MB per immagine, caricamenti sequenziali, 150 caricamenti/ora per sessione, JPEG/PNG/WebP/GIF/HEIC con verifica della firma. HEIC viene conservato originale; anteprime Google quando disponibili, la visualizzazione dell'originale dipende dal browser. Paginazione a 60 foto. Nessuna cancellazione dal sito. Errori parziali riportano quali foto riprovare. Animazioni rispettano la preferenza di movimento ridotto.

Prima di distribuire i chip, provare caricamento e download reali su iPhone e Android con Drive collegato. Il collegamento non funziona finché il proprietario non autorizza Google.
