# Aşama 2 Görev Özeti ve İş Sırası (tartışma notu, plan değil)

Kaynak: `gorev_tanimi.pdf` (11 sayfa, 2026-09-26) + Aşama 1 devir özeti.

## 1. Ne isteniyor?
Aşama 1 tespit modelini **tool olarak kullanan** bir LLM agent. Verilen bir drone görüntüsü için:
araçları bul → gerçek koordinata çevir → hareket kaydıyla eşleştir → hız/yön/üsse mesafe trendini çıkar →
saha raporlarıyla karşılaştır → **hangi durumların dikkat gerektirdiğini, nedenini ve dayandığı verileri** açıkla.
"Dikkat gerektirir mi" kararı ve gerekçesi tamamen bize bırakılmış (PDF bir eşik ya da skor tanımlamıyor).

## 2. Girdiler
| Dosya | İçerik | Not |
|---|---|---|
| `images/` | 40 drone görüntüsü | Kuşbakışı, perspektif düzeltilmiş; üst = kuzey, sol = batı |
| `image_meta.json` | px boyutu, çekim saati, 4 köşe (WGS84) | Formül sadece 3 köşe kullanıyor; 4. köşe tutarlılık kontrolü için |
| `zones.json` | Merkez üs + 8 bölge adı ve koordinatı | Raporlardaki bölge adlarını çözmek için |
| `tracks.csv` | `track_id, time, lat, lon`; 5 dk adım, 2 saatlik iz | **Her iz, ait olduğu görüntünün çekim anında biter.** Tüm görüntüler için tek havuz |
| `field_reports.json` | `time, source (official/third_party), text` | Konum metin içinde (koordinat veya bölge adı). Doğru/hatalı/ilgisiz olanlar işaretli değil |

Tam JSON şemaları PDF'te yok; veri paketi gelince ilk iş bunlara bakmak.

## 3. Hesaplama kuralları (PDF'ten)
- `lon = TL.lon + (x/W)·(TR.lon − TL.lon)`, `lat = TL.lat + (y/H)·(BL.lat − TL.lat)`; araç konumu = kutu merkezi.
  Örnekle doğruladım: (640,394), 1360×765 → (39.94439, 32.86350) çıkıyor.
- Eşleşme: `time == çekim saati` satırları arasında en yakın nokta, "makul" mesafe eşiğiyle (örnekte ~2,5 m). Birebir eşitlik yok.
- Hız ve yön **tek adımdan değil tüm izden** okunmalı (araçlar durur, döner, üs çevresinde dolaşır).
- Park halindeki aracın izi olmayabilir; izi olan araç görüntü dışında kalmış olabilir → eşleşmeyenler normal durum.
- Rapor ile tespit çelişirse **tespit esas alınır**.

## 4. Çıktı, değerlendirme, teslim
- **PDF'te değerlendirme kriteri, çıktı formatı ve teslim şartı YOK.** Bunlar devir özetinden (brief sunumu) geliyor:
  mentorlar kod kalitesi + mimari; jüri iş değeri, çalışan ürün, UX, sunum/demo; canlı demoda en az 1–2 görüntüde gerçekten çalışmalı
  (chatbot / web app / CLI / sesli asistan serbest). Teslim tarihi ve formatı organizatörden teyit edilmeli.
- "Risk brief" ifadesi PDF'te geçmiyor; PDF "dikkat gerektiren durumlar + gerekçe + dayanak veri" diyor. Aynı şey, ama zorunlu bir skor yok.

## 5. LLM kısıtları (GLM-5.3-Flash, OpenAI uyumlu gateway)
- Bütçe 15 USD (sıfırlanmaz), 60 istek/dk, 500K token/dk, **aynı anda 4 istek**, ~1M context.
- Her zaman reasoning yapar: `reasoning_effort` low/high/max; `thinking` parametresi hata verir; `max_tokens` düşükse content boş döner (1000+ ya da hiç verme). Low ile ~10–15 sn/çağrı → demoda streaming.
- Tool calling destekli; **görüntü okuyabilir** (960×540 ≈ 700 token). **Embeddings yok** → vektör RAG yapılamaz (bu veri boyutunda gerek de yok).
- OpenAI SDK, OpenAI Agents SDK (`set_default_openai_api("chat_completions")`, tracing kapalı) ve Anthropic formatı çalışıyor.
  .NET tarafında OpenAI uyumlu bir client da base URL değiştirilerek kullanılabilir (çıkarım, test edilmedi).

## 6. Aşama 1 ile bağlantı ve çelişkiler
- Tutarlı: 40 görüntü, 8 bölge, 2 saatlik iz, 15 USD GLM, doğrusal interpolasyon, "kendi tespitine güven", orijinal boyut kullanımı.
- **Risk: domain shift.** Aşama 1 verisi eğik açılı (bu yüzden `flipud=0`), Aşama 2 görüntüleri kuşbakışı. Örnek boyut 1360×765 da eğitim boyutlarından farklı.
  Model C'nin bu 40 görüntüde ne kadar iyi çalıştığı bilinmiyor; ilk ölçülecek şey bu. Kuşbakışında `flipud` artık zararsız, gerekirse TTA düşünülebilir.
- Eşleşme mesafesi: devir özeti "<1 m", PDF "~2,5 m, birkaç metre sapma olabilir" diyor → eşik birkaç metre + GSD'ye göre ayarlanmalı.
- PDF'teki sayılar temsili ve kendi içinde tutarsız (9 m/s hız ama 1 saatte sadece 2,8 km yaklaşma). Test beklentisi olarak kullanmayın; "yaklaşma hızı" ile "yer hızı" ayrı metrikler.

## 7. Hangi işler, hangi sırayla (bağımlılıklar)
0. **Ön koşul:** veri paketi (images + 4 dosya) ve takım API key'i. Key ile `/key/info` ve tek bir chat çağrısı.
1. **Veri keşfi** (← 0): JSON şemaları, saat formatı/zaman dilimi, track sayısı, rapor sayısı ve dili, görüntü boyutlarının meta ile uyumu.
2. **Tespit doğrulama** (← 0, model C ağırlığı): 40 görüntüde çıktıya göz at, conf eşiği, agnostic NMS. *En büyük belirsizlik, en erken yapılmalı.*
3. **Geo araçları** (← 1): piksel→koordinat, haversine mesafe, bearing, görüntü footprint'i, bölge adı→koordinat. PDF örneğiyle test.
4. **Track eşleme + hareket özellikleri** (← 2, 3): çekim anı filtresi, en yakın eşleşme + eşik, tüm izden hız/yön/üsse mesafe trendi/duraklama.
   Tersine kontrol: footprint içinde bitip tespitle eşleşmeyen izler = kaçırılmış tespit adayı.
5. **Rapor ilişkilendirme** (← 1, 3): konumu çıkar (koordinat regex / bölge adı; LLM yardımcı olabilir), zaman penceresi, görüntüye yakınlık, iddia (tip/sayı/hareket) ↔ tespit karşılaştırması.
6. **Değerlendirme + agent döngüsü** (← 4, 5): kural tabanlı baz skor + LLM gerekçesi; iterasyon sınırı; rapor metni veri olarak (prompt injection).
7. **Demo arayüzü** (← 6): görüntü + kutular + harita + adım log'u + brief.

Paralel yürüyebilenler: 2 ile 3 ve 5 birbirinden bağımsız. Kritik yol: 0 → 2 → 4 → 6 → 7.
Stack kararı (Python mu, .NET orchestrator + Python inference mı) 3'e başlamadan verilmeli, çünkü tool'ların nerede yaşayacağını belirliyor.

## 8. Açık sorular
- Veri paketi elinizde mi? Teslim zamanı ve formatı (kod repo, video, sunum) ne?
- Değerlendirmede tüm 40 görüntünün çıktısı mı isteniyor, yoksa yalnızca canlı demo mu?
- Rapor zaman penceresi: çekimden kaç dakika önceki raporlar ilgili sayılmalı? (PDF örneği 45 dk öncesini kullanıyor.)
