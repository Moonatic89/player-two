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

## Gioco degli invitati
Il database SQLite `data/player2.sqlite` conserva profili, accessi, tentativi ed EXP nel volume già persistente dell'app (insieme alle credenziali Drive, che non vengono sostituite dal deploy). Richiede Node >=22.13 per `node:sqlite`; Node 22 segnala ancora il modulo come sperimentale. Nessuna dipendenza esterna.

Il cookie personale `p2player` è casuale a 256 bit, HttpOnly e Secure in HTTPS, dura un anno e sul database è conservato solo il suo hash. Identifica il browser, non una persona verificata: cambio di rete supportato, cancellazione dei cookie/incognito/nuovo dispositivo creano un nuovo profilo. Nessun fingerprint o IP conservato. Gli accessi al sito sono raggruppati per profilo in finestre di 30 minuti.

60 missioni con nomi a tema in `quests.mjs`: 30 facili (20 EXP), 20 medie (40), 10 difficili (80). Nickname modificabile, nessuna classifica pubblica. Un livello ogni 100 EXP. Una quest attiva per profilo e una sola prenotazione globale della stessa quest; transazioni SQLite e indici unici proteggono dalle assegnazioni simultanee. Completamento e abbandono usano l'ID del tentativo e non sono ripetibili. Penalità del 25% con minimo zero. Quest completate e abbandonate non tornano mai al medesimo profilo, ma si liberano per gli altri. Dopo 12 ore la prenotazione scade senza penalità; le scadute possono essere riassegnate anche al medesimo profilo. La scadenza viene applicata alla prima lettura o azione successiva. Il diario mostra gli ultimi 30 tentativi conclusi, lo storico completo rimane nel DB.

Il consenso delle persone coinvolte è incluso nelle missioni. La missione del "furto" cosplay è un prestito autorizzato e restituito subito. Conferma sulla fiducia, senza verifica della foto o moderazione.

Backup del gioco: usare SQLite online backup / `VACUUM INTO` verso un percorso protetto e salvare anche `google.json` separatamente. Non copiare a caldo soltanto il file `.sqlite` ignorando il WAL. Nessun backup o token deve entrare nella repository. I test creano database temporanei senza toccare quelli del server.

## Cabina degli sposi
Generare `OWNER_TOKEN` casuale (32 byte) separato dai token invitati e Google. Aprire `/sposi/accesso/OWNER_TOKEN`: crea un cookie HttpOnly dedicato di 30 giorni e reindirizza a `/sposi` senza chiave nell'indirizzo. Il link è condivisibile solo tra gli sposi; cambiarne il token revoca anche le sessioni esistenti. La pagina e tutte le sue risorse/API richiedono questo cookie, il token invitati non è sufficiente.

Riepilogo con giocatori, quest attive, completate e abbandonate; browser totali distinti (non persone verificate). Elenco dei nickname per EXP con ultimo accesso, visite raggruppate in finestre di 30 minuti e quest attuale. Ricerca per nickname e diario completo di ciascun profilo, paginato a 50 tentativi. Vista in sola lettura, riepilogo aggiornato ogni 30 secondi; il diario si ricarica riaprendolo. Non espone cookie, hash o credenziali Google.
