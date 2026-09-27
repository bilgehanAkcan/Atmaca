# BaseGuard

Level Up AI | ROKETSAN Hackathon, Aşama 2. Drone görüntülerindeki araçları Aşama 1 tespit modeliyle bulan, hareket kayıtları ve saha raporlarıyla karşılaştıran, üs için dikkat gerektiren durumları kanıtlarıyla açıklayan LLM agent.

- Mimari, sözleşmeler, ekip ve plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Veri bulguları: [docs/PLAN_AND_DATA_FINDINGS.md](docs/PLAN_AND_DATA_FINDINGS.md)
- Agent yaklaşımları karşılaştırması: [docs/AGENT_APPROACHES.md](docs/AGENT_APPROACHES.md)
- Görev özeti: [docs/TASK_SUMMARY.md](docs/TASK_SUMMARY.md)

## Kurulum
```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # GLM_API_KEY değerini girin
```
Veri paketi (`images/`, `image_meta.json`, `zones.json`, `tracks.csv`, `field_reports.json`) `data/` altına konur ve repoya commit edilmez. Model ağırlığı (`best_map50.pt`) da repoya girmez.
