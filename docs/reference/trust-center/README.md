# Referință: centru de încredere

Capturi de ecran pentru pagina publică `trust.domeniu.com`. Sunt folosite ca referință de layout și
comportament, nu ca sursă de conținut. Pagina publică este în engleză. Textele din aplicație sunt
provizorii și vor fi derivate din criteriile de conformitate (NIS2, ISO 27001, EU AI Act) prin
pipeline-ul de conținut din `.agents/`.

## Ce rămâne constant pe toate ecranele

- Header alb, lipit sus, pe toată lățimea, cu doar logo-ul încărcat de organizație. Header-ul nu
  afișează nume, inițiale sau domeniu ca text.
- Bară generală de navigare sub header, pe un rând: Overview, Resources, Controls, Subprocessors,
  Updates, iar la dreapta acțiunile „Subscribe” și „Request access”. Taburile au underline pe cel
  activ și scroll orizontal pe ecrane mici. Bara nu este lipită la derulare; doar header-ul rămâne
  sus.
- Conținut pe fundal alb, carduri cu bordură subțire, tipografie sobră și mult spațiu liber.
- Liste lungi paginate, cu interval vizibil („1–10 din N rezultate”).
- Buton plutitor „Înapoi sus” după derulare.

## Ecrane

### `01-overview.jpg`

Prima impresie: hero întunecat, full-bleed, cu forme abstracte tridimensionale în dreapta. Sub el,
taburile. Coloana stângă are cardul de conformitate și lista de resurse; coloana dreaptă are cardurile
de controale pe două coloane, fiecare cu un preview de trei afirmații bifate și link „Vezi toate”.

### `02-overview-scrolled.jpg`

Confirmă headerul lipit în timpul derulării; bara de taburi iese din ecran. Cardurile de controale
păstrează aceeași structură, iar coloana laterală rămâne aliniată la începutul conținutului.

### `03-overview-bottom.jpg`

Continuarea prezentei: lista de subprocesatori cu logo, nume, scop și regiune, apoi cardurile de
actualizări cu etichetă, dată, text trunchiat și link „Citește mai mult”.

### `04-controls.jpg`

Tab Controale: titlu, pill „Actualizat”, căutare, categorii în stânga și tabel cu două coloane
(Control, Status). Fiecare rând are titlu, descriere și bifă verde. În implementare, sidebar-ul
rămâne vizibil, dar toate grupurile sunt afișate unul după altul; click pe categorie derulează la
grupul corespunzător.

### `05-controls-pagination.jpg`

Aceeași listă la final: paginare cu interval și săgeți, plus stare dezactivată pentru prima pagină.

### `06-resources.jpg`

Tab Resurse: buton închis la culoare pentru descărcare în bloc, căutare, categorii Documente și
Confidențialitate, rânduri cu titlu, link de copiere și buton „Cere acces” pentru documentele
restricționate.

### `07-subprocessors.jpg`

Tab Subprocesatori: căutare sus-dreapta, listă fără coloane suplimentare, fiecare rând cu logo,
nume, scop și regiune în dreapta.

## Decizii pentru implementare

- **Fără acuzații de certificare.** Statusurile folosesc „Aligned (declared)” și „In preparation”.
  Footerul spune explicit că pagina nu este o certificare emisă de un organism acreditat.
- **Conținut separat de layout.** Afirmațiile, resursele, subprocesatorii și actualizările sunt
  entități de domeniu, servite prin `TrustCenterContentRepository`. Descrierile actuale sunt mostre;
  înlocuirea lor cu text derivat din criterii nu schimbă componenta.
- **Hero fără imagine generată.** Formele abstracte sunt construite în CSS, ca să nu adauge o
  dependență de asset și să rămână în paleta organizației.
- **Logo încărcat de tenant.** Header-ul afișează doar imaginea din setările centrului de încredere
  (`logoUrl`), fără nume, inițiale sau domeniu ca text. Administrarea permite încărcarea unui SVG,
  PNG sau JPG de maximum 512 KB.
- **Cererile nu au backend.** Formularul de acces și abonare pregătește un mesaj `mailto:` către
  contactul organizației. Pagina nu stochează date.
- **Paginare pe client.** Fiecare listă are propriul prag: 10 controale, 6 resurse, 10 subprocesatori,
  4 actualizări. Datele vin deja filtrate pe organizație din repository.
