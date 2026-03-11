# 🎨 DiffuseChat — Gerador de Imagens com Stable Diffusion

Interface chatbot premium com geração de imagens IA usando os modelos do arquivo `stable_diffussion/`.

---

## 📁 Estrutura do Projeto

```
sd-chatbot/
├── backend/
│   ├── app.py                  ← Servidor Flask (API)
│   ├── requirements.txt        ← Dependências Python
│   └── stable_diffussion/      ← Componentes do modelo SD
│       ├── __init__.py
│       ├── activations.py
│       ├── attention.py
│       ├── attention_processor.py
│       ├── autoencoder_kl.py
│       ├── embeddings.py
│       ├── resnet.py
│       ├── transformer_2d.py
│       ├── unet_2d_blocks.py
│       ├── unet_2d_condition.py
│       ├── unet_blocks.py
│       └── vae.py
├── frontend/
│   ├── index.html              ← Interface principal
│   ├── css/
│   │   └── style.css           ← Estilos dark blue premium
│   └── js/
│       └── app.js              ← Lógica do frontend
└── README.md
```

---

## ⚙️ Requisitos

- **Python 3.10+**
- **GPU NVIDIA** (recomendado, CUDA 11.8+) ou CPU (muito mais lento)
- ~5 GB de espaço em disco para o checkpoint do modelo
- Conexão com internet na primeira execução (download do checkpoint)

---

## 🚀 Instalação e Execução

### 1. Clonar / extrair o projeto

```bash
cd sd-chatbot
```

### 2. Criar ambiente virtual

```bash
python -m venv venv
source venv/bin/activate        # Linux/macOS
# ou
venv\Scripts\activate           # Windows
```

### 3. Instalar dependências

```bash
cd backend
pip install -r requirements.txt
```

### 4. (Opcional) Configurar modelo

Por padrão o servidor usa `runwayml/stable-diffusion-v1-5` do HuggingFace.
Para usar outro modelo:

```bash
export SD_MODEL_ID="stabilityai/stable-diffusion-2-1"  # Linux/macOS
# ou
set SD_MODEL_ID=stabilityai/stable-diffusion-2-1       # Windows
```

### 5. Iniciar o servidor

```bash
python app.py
```

O servidor inicia em **http://localhost:5000**

Abra o browser e acesse `http://localhost:5000` — a interface carrega automaticamente.

---

## 🖼️ Como Usar

1. **Nova Conversa** — clique no botão na barra lateral ou use um dos chips de sugestão na tela inicial
2. **Digite o prompt** — descreva a imagem desejada no campo de texto
3. **Enviar** — pressione `Enter` ou clique na seta → 
4. **Aguardar** — a geração leva entre 10s–120s dependendo do hardware
5. **Baixar** — passe o mouse sobre a imagem e clique em "Baixar", ou clique para ampliar e use o botão de download

### Parâmetros Avançados

Clique no ⚙️ canto superior direito para ajustar:

| Parâmetro | Descrição | Padrão |
|-----------|-----------|--------|
| Prompt negativo | O que evitar na imagem | ugly, blurry... |
| Largura / Altura | Resolução da imagem | 512 × 512 |
| Passos | Mais passos = mais qualidade (e mais lento) | 25 |
| Guidance Scale | Quanto o modelo segue o prompt (CFG) | 7.5 |
| Seed | Reproduzir a mesma imagem (-1 = aleatório) | -1 |

---

## 🔧 Integração dos Componentes Customizados

Os arquivos em `stable_diffussion/` são implementações customizadas de:

- `vae.py` / `autoencoder_kl.py` — VAE (codificador/decodificador de imagem)
- `unet_2d_condition.py` / `unet_2d_blocks.py` / `unet_blocks.py` — UNet de difusão
- `attention.py` / `attention_processor.py` — Mecanismos de atenção
- `embeddings.py` — Embeddings posicionais e de tempo
- `resnet.py` — Blocos ResNet
- `transformer_2d.py` — Transformer 2D

Para substituir os componentes padrão do diffusers pelos customizados, edite `backend/app.py` e descomente as linhas da seção **"Optionally swap in custom model components"**.

---

## 🌐 API REST

O backend expõe uma API REST completa:

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `GET  /api/status` | GET | Status do modelo e GPU |
| `GET  /api/chats` | GET | Listar todas as conversas |
| `POST /api/chats` | POST | Criar nova conversa |
| `GET  /api/chats/:id` | GET | Obter conversa com mensagens |
| `DELETE /api/chats/:id` | DELETE | Excluir conversa |
| `PATCH /api/chats/:id/title` | PATCH | Renomear conversa |
| `POST /api/generate` | POST | **Gerar imagem** |

### Exemplo de chamada `/api/generate`:

```json
POST /api/generate
{
  "chat_id": "abc123",
  "prompt": "A futuristic city at night, neon lights",
  "negative_prompt": "ugly, blurry",
  "width": 512,
  "height": 512,
  "steps": 30,
  "guidance_scale": 7.5,
  "seed": -1
}
```

---

## 🔮 Próximas Melhorias Planejadas

O projeto foi estruturado para facilitar adições futuras:

- **Novos modelos** — adicionar ao diretório `backend/` e expor via variável de ambiente ou seletor na UI
- **img2img** — novo endpoint `/api/img2img` com upload de imagem base
- **Inpainting** — edição de regiões específicas da imagem  
- **ControlNet** — controle preciso de pose/estrutura
- **SDXL** — suporte ao modelo maior de alta resolução
- **Histórico persistente** — migrar de `dict` in-memory para SQLite
- **Autenticação** — sistema de usuários para deploy público

---

## 🐛 Solução de Problemas

**"Servidor offline" na interface**
→ Certifique-se que `python app.py` está rodando e acesse http://localhost:5000

**Erro CUDA out of memory**
→ Reduza a resolução para 512×512 e os passos para 20

**Geração muito lenta**
→ Normal em CPU. Para acelerar, use GPU NVIDIA ou reduza os passos

**Modelo não carregado**
→ A primeira execução faz download do checkpoint (~4 GB). Aguarde e recarregue.
