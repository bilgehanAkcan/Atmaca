# A.R.E.S. Komuta Kontrol Merkezi — ATMACA Takımı

Electron + Vite + React + TailwindCSS + React Three Fiber + drei + Framer Motion. Masaüstü düzeni: %70 3D harita, %30 asistan. Arazi gerçek DEM karolarından indirilir. Dost/düşman sınıfları sentetik, radar dalgası görsel simülasyondur; canlı hedef takibi veya radar cihazı bağlantısı yoktur. Sohbet yerel demodur, kamera paneli yer tutucudur.

## Çalıştırma

Node.js 22.12+ gerekir. Bu dizinde:

```sh
npm install
npm run dev
```

`npm run dev` Vite ve Electron süreçlerini birlikte başlatır; biri kapanınca diğeri sonlandırılır. Sunucu yalnızca `127.0.0.1:5173` dinler. Electron için grafik masaüstü oturumu gerekir.

Yalnızca tarayıcıda denemek için `npm run dev:web` ve `http://127.0.0.1:5173`.

```sh
npm test
npm run build
npm start
```

`npm start`, derlenmiş `dist/index.html` dosyasını Electron içinde açar. Dağıtılabilir kurulum paketi oluşturma kapsam dışındadır. Kilit dosyasıyla tekrarlanabilir kurulum için `npm ci` kullanılabilir.

## Kaynaklar

- `src/App.jsx`: splash → demo giriş → dashboard akışı, %70/%30 düzen, HUD ve görüntü paneli.
- `src/TacticalRadarMap.jsx`: API yükleme yaşam döngüsü, holografik tel kafes, radar shader'ı, simülasyon işaretçileri ve Canvas.
- `src/CameraRig.jsx`: kuş bakışı ve dalış kamera animasyonu.
- `src/lib/fetchTerrain.js`: iptal edilebilir Terrarium fetch/decode ve sınırlı bellek önbelleği.
- `src/lib/terrain.js`: karo koordinatları, DEM örnekleme ve mesafe matematiği.
- `src/lib/terrainGeometry.js`: PlaneGeometry vertex güncellemesi.
- `src/Chatbot.jsx`: seçili bölge bağlamı, mesaj formu, yerel demo yanıtları.
- `src/data/locations.js`: verilen JSON ve metre tabanlı projeksiyon.
- `src/lib/navigation.js`: geçiş sırasını koruyan durum makinesi.
- `electron/main.cjs`: izole, sandbox etkin Electron penceresi.

## Sinematik açılış

`App.jsx` içindeki `appState`, `splash`, `auth` ve `dashboard` aşamalarını yönetir. `AnimatePresence mode="wait"`, önceki ekranın fade-out geçişi bitmeden sonraki ekranı açmaz.

- Splash merkezde aydınlanan koyu zeytin/antrasit radyal gradyanda logo, yeşil-kırık beyaz terminal metni ve 3 saniyede dolan yeşilden sıcak sarıya geçen bar gösterir. 3 saniye sonunda 0,45 saniyelik fade-out başlar.
- Logo için `public/roketsan.png` ekleyin. Görsel bulunmazsa yazılı yer tutucu gösterilir. Şeffaf logonun siyah yazısı CSS `brightness-0 invert` ile beyaz sunulur; PNG dosyası değiştirilmez. Vite `BASE_URL` kullanımı Electron'un göreli dosya yollarıyla uyumludur.
- Demo giriş paneli zeytin tonlu kenarlıklarla, fırçalanmış metal fon üzerinde koyu cam yüzey kullanır. Operatör ID ve maskelenmiş erişim kodu alanlarında yaprak yeşili odak halkası, bağlantı düğmesinde yeşil hover vardır. Doğrulama yoktur; boş alanlar dahil her gönderim kabul edilir. Alanlar sunucuya gönderilmez veya depolanmaz. Bu akış gerçek erişim kontrolü sağlamaz.
- SİSTEME BAĞLAN ardından 1 saniye ERİŞİM ONAYLANDI mesajı gösterilir; tekrar gönderim devre dışıdır. Ardından panel kapanır ve mevcut radar/sohbet dashboard'u fade-in ile açılır.
- Zamanlayıcılar unmount ve React StrictMode için temizlenir. Hareket azaltma tercihinde geçişler anlıktır; 3 saniye ve 1 saniyelik aşama süreleri korunur. Giriş alanına ve dashboard başlığına klavye odağı aktarılır.
- Sayfa yenilendiğinde açılış akışı baştan oynar. Radar bileşeni ve DEM istekleri yalnızca dashboard açıldığında başlar.

## Koordinatlar ve kamera

Merkez üs `(0, 0, 0)` noktasıdır. Dünya yarıçapı `6,371,000 m` alınarak yerel eşdikdörtgensel projeksiyon uygulanır:

```text
x = R × (lon − baseLon) × π/180 × cos(baseLat × π/180) × 0.01
z = −R × (lat − baseLat) × π/180 × 0.01
y = (noktanın DEM yüksekliği − merkez üs DEM yüksekliği) × 0.01
```

1 sahne birimi = 100 metre. Doğu +X, kuzey −Z. Sekiz nokta merkezden yaklaşık 3.2 km uzaklıktadır. Bu küçük alan demosu için bir yaklaşımdır; geniş alan veya hassas ölçüm için uygun CRS/ENU projeksiyonu gerekir.

## TacticalRadarMap kullanımı

Mevcut `App.jsx` bileşeni radar haritasını doğrudan kullanır. Başka bir React ekranında:

```jsx
import TacticalRadarMap from './TacticalRadarMap.jsx';
import './styles.css';

export default function RadarScreen() {
  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <TacticalRadarMap />
    </div>
  );
}
```

Bileşen kendi Canvas'ını oluşturur; başka bir Canvas içine koymayın. Başka projeye taşırken `CameraRig.jsx`, `data/locations.js`, `lib/terrain.js`, `lib/terrainGeometry.js`, `lib/fetchTerrain.js` ve ilgili CSS kurallarını da taşıyın. Ek npm bağımlılığı veya API anahtarı gerekmez.

Opsiyonel `targets` prop'u `{ id, name, center: [lat, lon], affiliation: 'friendly' | 'hostile' }` nesnelerinden oluşan bir dizidir. Yeni bir dizi ile koordinatları güncellemek, yeniden API çağrısı yapmadan konumları ve mesafeleri yeniden hesaplar. Varsayılan olarak verilen sekiz bölge kullanılır; sınıflar dönüşümlü dost/düşman demolarıdır. Noktalar yaklaşık eşit uzaklıkta olduğundan varsayılan darbe hızları da birbirine yakındır.

`onSelect(target)` tıklanan konumun araziye oturtulmuş `position`, `elevationMeters` ve `distanceMeters` alanlarını verir. Mevcut uygulama `phase`, `zone`, `onArrived` ve `onSelect` prop'larıyla kamera/panel akışını yönetir. Tek başına kullanım radar görünümünü sağlar; görüntü paneli `App.jsx` içindedir. `onTerrainStatus(status)` yükleme durumunu (`loading`, `ready`, `error`) bildirir. `reducedMotion` verilmezse işletim sisteminin hareket azaltma tercihi kullanılır.

Tema vurguları `styles.css` içinde `--accent: #84a94b`, `--accent-hover: #9ab75d` ve `--accent-secondary: #d3b55a` ile tanımlanır. Dashboard'un %70 harita / %30 sohbet düzeni korunur; kenarlıklar, başlıklar ve cam yüzeyler logo yeşili, sıcak sarı ve nötr zeytin/antrasit paletine uyarlanır.

## DEM ve radar ayrıntıları

- Kaynak: [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), [Tilezen Terrarium formatı](https://github.com/tilezen/joerd/blob/master/docs/formats.md).
- Endpoint: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. HTTP üzerinden gerçek veri indirilir; kaynak periyodik güncellenen bir DEM arşividir, canlı yükseklik sensörü değildir.
- Ankara merkezli 15 × 15 km alan, zoom 12'de kapsama göre seçilen 256 × 256 karolar ile yüklenir. Görünür topografi yarıçapı 7,5 km'dir. `64 × 64` segmentli düzlemde 4.225 vertex bulunur. Ağ aralığı yaklaşık 234 m'dir; daha sık mesh örneklemesi kaynak çözünürlüğünü artırmaz. Kuş bakışı kamera kadrajı arazi boyutuna göre ayarlanır.
- RGB yükseklik çözümü: `R × 256 + G + B / 256 − 32768`. Renk dönüşümü kapatılır. Web Mercator karolarından piksel merkezlerini hesaba katan bilinear örnekleme yapılır; karo sınırlarında komşu karo okunur.
- Merkez rakımı tüm vertexlerden çıkarılır; merkez üs tam `(0,0,0)` olur. Yatay ve düşey ölçek aynıdır; gizli yükseklik abartısı yoktur. Bir DEM örneği zeminin yaklaşık modelidir, ölçüm doğruluğu garantisi değildir.
- Hedeflerin Y değeri, mesh'in aynı üçgen yüzeyinde barycentrik enterpolasyonla hesaplanır. Bu, hücre içindeki bilinear değer ile üçgen yüzeyi arasında oluşabilecek havada kalmayı önler. İşaretçinin konum ankrajı ve koni taban merkezi arazi yüzeyine oturur; fiziksel cisim/zemin çarpışma simülasyonu yapılmaz. DEM dışındaki veya geçersiz hedefler çizilmez.
- Arazi koyu zeytin grisi tel kafesle çizilir; toplamsal parlama yerine normal saydamlık kullanılır. Shader merkezden kenara saydamlaşır. Altındaki loş koordinat düzlemi 500 m aralıklı grid ile 2 km, 4 km ve 6 km referans halkalarını gösterir. Arazi arka plana yakın koyu zeytin grisidir. Radar bandı ölçülü altın sarısı tondadır; dost işaretçileri yeşil, düşman işaretçileri sarı ve merkez üs açık bej görünür. Radar bandı, aynı DEM geometrisini kullanan ayrı bir yüzey katmanında 8 saniyelik çevrimle ilerler; seyrek tel kafes çizgileri arasındaki boşluklarda da kesintisiz görünür. Bandın rengi ve sönümü arazi opaklığından bağımsızdır; yalnızca bant ve kısa izi çizilir, her karede vertex taşınmaz. Dostlar sabittir; düşman opaklığı 0.5–2.5 Hz aralığında mesafeye bağlı değişir. Hareket azaltma modunda radar halkası sabit gösterilir ve hedeflerin yanıp sönmesi durur.
- Kesikli çizgiler merkez ile hedef arasındaki düz vektördür; arazinin arkasında kaybolmaması için HUD çizgisi olarak çizilir. Mesafe etiketleri WGS84 enlem/boylamdan küresel Haversine yaklaşımıyla hesaplanan yatay kuş uçuşu mesafedir; araziyi izleyen yol uzunluğu değildir.
- İstek başına 20 saniye zaman aşımı, unmount/StrictMode iptali, en fazla dört eşzamanlı indirme, 10 dakika TTL ve en fazla 24 çözülmüş karo önbelleği vardır. Arıza halinde hata ve yeniden deneme düğmesi gösterilir; sahte arazi otomatik olarak devreye girmez.
- Geometri sadece DEM değiştiğinde güncellenir. Kare döngüsünde React state güncellenmez; shader uniform ve materyal opaklığı değişir. R3F geometri/materyalleri, decoder ise ImageBitmap nesnelerini temizler.

Kaynak kredileri arayüzde bulunur: Mapzen/Tilezen, USGS SRTM/GMTED2010, AB finansmanlı Copernicus EU-DEM ve NOAA ETOPO1. Veri yeniden örneklenip merkeze göre göreli yüksekliğe dönüştürülür. Kaynağa göre değişen lisans/kredi ayrıntıları: [Tilezen attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

İşaretçi ya da alttaki kamera kartı seçildiğinde `overview → diving → focused` akışı başlar. Kamera konumu ve bakış hedefi 2.2 saniye boyunca kare hızından bağımsız yumuşatılır. Panel, animasyonun bitiş callback'i ile açılır. Geri dönüşte `focused → closing → returning → overview` sırası izlenir; Framer Motion `onExitComplete` çalışmadan kamera geri hareket etmez. Dalış sırasında da Escape veya KUŞ BAKIŞI ile dönüş mümkündür. Geçişlerde yeni seçimler kilitlenir. Hareket azaltma tercihi desteklenir.

## Entegrasyon

Sohbet ve görüntü paneli BaseGuard agent backend'ine bağlıdır (`src/lib/agentApi.js`). API anahtarları yalnızca backend'in `.env` dosyasındadır; renderer sadece `http://127.0.0.1:8000` uçlarını çağırır. Önce backend'i proje kökünden başlatın:

```sh
.venv/bin/uvicorn --app-dir src --factory baseguard.api.app:create_app --host 127.0.0.1 --port 8000 --timeout-graceful-shutdown 3
```

`--timeout-graceful-shutdown 3`, açık sohbet akışı varken Ctrl+C'nin "Waiting for application shutdown" mesajında takılmasını önler. Port dolu hatasında eski süreci `lsof -nP -iTCP:8000 -sTCP:LISTEN` ile bulun.

- `GET /api/images`, `/api/images/{id}/file`, `/api/images/{id}/detections`: bölge başına 5 drone görüntüsü ve tespit işaretleri.
- `POST /api/chat`: agent adımlarını (`session`, `tool_call`, `tool_result`, `brief`, `done`, `error`) SSE olarak akıtır; `session_id` ile takip soruları aynı oturumda kalır.
- Farklı adres için `VITE_API_BASE` tanımlayın ve `index.html` CSP'sindeki `connect-src`/`img-src` iznini güncelleyin.

Electron `nodeIntegration: false`, `contextIsolation: true` ve `sandbox: true` kullanır. Renderer'a dosya sistemi veya süreç erişimi verilmez. CSP, Vite React Refresh başlangıç betiği için sunucu/derleme başına üretilen nonce kullanır.

`index.html` içindeki CSP `connect-src`, Terrarium bucket yolunu ve yerel agent backend'ini (`http://127.0.0.1:8000`) ek olarak açar. Başka uygulamaya taşınırken aynı ağ iznini ekleyin. Renderer güvenlik ayarlarını veya CORS korumasını kapatmak gerekmez.

## Kontrol

`npm test` projeksiyon, RGB çözümleme, dört karo sınırındaki enterpolasyon, sıfır referans rakımı, gerçek Three.js raycast ile terrain hugging, darbe sınırları ve panel geçişlerini doğrular. Test verileri deterministik ve ağdan bağımsızdır. `npm run build` üretim derlemesini oluşturur. Arayüzde DEM yükleme, hata halinde yeniden deneme, sekiz noktayı seçme, görüntü paneli ve Escape ile dönüş ayrıca kontrol edilebilir.

Resmî dokümantasyon: [React Three Fiber kurulumu](https://r3f.docs.pmnd.rs/getting-started/installation), [Tailwind Vite kurulumu](https://tailwindcss.com/docs/installation/using-vite), [Electron güvenliği](https://www.electronjs.org/docs/latest/tutorial/security).
