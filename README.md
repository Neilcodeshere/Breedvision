# BreedVision

Identify Indian cattle breeds from a photo. You upload a picture of a cow, and the app tells you which of 49 indigenous breeds it most likely is, how sure it is, and where in the image the model found its evidence.

## Overview

Indian cattle breeds are hard to tell apart: many of them look alike, the public datasets are small, and a classifier will happily name a breed for a photo of a car. A label with a percentage next to it isn't enough. So I built the whole thing end to end, from cleaning the dataset to a web app that is honest about how confident the model actually is.

The project has three parts:

- **`ml/`** – the dataset pipeline and training code. Most of the work went here.
- **`backend/`** – a FastAPI server that loads the trained model and exposes classify, explain and detect endpoints.
- **`web/`** – a Next.js app for identifying breeds, browsing a breed library and keeping a history of identifications.

The part I find most interesting is the dataset work. The Kaggle dataset has a lot of near-duplicate photos of the same animal, so a random train/test split leaks images between the two and inflates the accuracy. I grouped near-duplicates with perceptual hashing and split by group instead, which gives a lower but more honest number.

## Results

These come from the evaluation files in `docs/examples/`, measured on a held-out test split of 1,114 images that wasn't used for training or for tuning thresholds.

| Model | Top-1 | Top-3 | Top-5 |
|---|---|---|---|
| EfficientNet-B0, frozen backbone + linear head | 59.2% | 81.6% | 90.0% |
| EfficientNet-B0, last blocks fine-tuned | 61.9% | 83.0% | 90.5% |

So the correct breed is in the top five about 90% of the time, but the single top guess is right only about 62% of the time. That is why the app shows the top candidates and a confidence band instead of one answer.

## Features

**ML pipeline**
- Dataset inventory with full-decode checks for corrupt or tiny images
- Exact and near-duplicate detection with pHash, grouped into same-animal clusters
- Group-aware train/val/test splits (StratifiedGroupKFold), plus a naive split kept only to measure how much leakage it would have caused
- Frozen-backbone baselines across several architectures, then partial fine-tuning of EfficientNet-B0 on CPU
- Temperature scaling, with confidence thresholds derived from validation data instead of guessed
- An out-of-distribution check (Mahalanobis distance in feature space) so non-cattle photos can be flagged
- Grad-CAM heat-maps showing where the model looked

**Backend**
- `POST /api/classify` – top-k breeds with calibrated confidence and a confidence band
- `POST /api/explain` – heat-map for the predicted breed
- `POST /api/detect` – YOLOv8 bounding boxes for the animal
- `GET /api/classify/info` – which model bundle is loaded and its thresholds

**Web app**
- Upload or take a photo and get the top candidates with a confidence indicator and heat-map
- Warns you if you upload a photo you've already identified (pHash, computed in the browser)
- Breed library with photos from Wikimedia Commons, with author and licence shown on each photo
- Identification history stored on-device in IndexedDB, with optional sync to Supabase
- An approximate value calculator and sales workspace (uses synthetic data, labelled as such)
- English, Hindi, Marathi, Tamil and Telugu

## Tech Stack

- **ML:** Python, PyTorch, timm (EfficientNet-B0), scikit-learn, pandas, ImageHash, OpenCV, pytest
- **Backend:** FastAPI, Uvicorn, Ultralytics YOLOv8, SQLite
- **Web:** Next.js, React, TypeScript, Tailwind CSS, IndexedDB
- **Optional cloud sync:** Supabase (Postgres with row-level security)

## Project Structure

```
backend/
  main.py              FastAPI app (classify, explain, detect + older herd endpoints)
  classifier.py        loads the model bundle, reuses ml/training/inference.py
  models/              model metadata; the .pt weights are not committed
ml/
  config.yaml          paths, seed and thresholds for the dataset pipeline
  dataset/             inventory, hashing, splitting, plots
  scripts/             one script per pipeline stage
  training/            train, fine-tune, calibrate, evaluate, OOD, Grad-CAM, export
  tests/               pytest suite (runs on a small synthetic fixture)
web/
  src/app/             pages: identify, breeds, history, prices, model, account
  src/services/        API client, mock layer, IndexedDB store, Supabase sync
  tests/               node:test unit tests
supabase/
  migrations/          schema and RLS policies
  tests/               RLS tests
docs/
  figures/             dataset plots
  examples/            test evaluation results
```

## Getting Started

### Prerequisites

- Node.js 20.19 or newer
- Python 3.13+ for the backend and ML code
- A trained model checkpoint if you want real predictions (see below)

```bash
git clone https://github.com/Neilcodeshere/Breedvision.git
cd Breedvision
```

### Web app

The web app runs on its own using a mock prediction layer, so you can try the UI without the backend.

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. While `NEXT_PUBLIC_USE_MOCKS=true`, every screen that shows mock data says so.

To run the tests:

```bash
npm test
npm run lint
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

`run.sh` and `run.bat` do the same thing. The API runs on http://localhost:8000.

The trained weights aren't in the repo (they're about 22 MB and `*.pt` is ignored). Put the checkpoint at `backend/models/breedvision_classifier.pt`, or point `BREEDVISION_CHECKPOINT` at it. Without a checkpoint the classify and explain endpoints return 503; the rest of the API still works.

Then set `NEXT_PUBLIC_USE_MOCKS=false` in `web/.env.local` and restart the web app.

### ML pipeline

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r ml/requirements.txt
pip install torch torchvision timm     # needed for training and two of the tests
python -m pytest ml/tests
```

`ml/config.yaml` points at `C:/bv-data`, because I kept the dataset outside the repo on my machine. Change the paths under `paths:` before running anything else.

The stages run in this order:

```bash
python ml/scripts/download_dataset.py      # needs Kaggle API credentials
python ml/scripts/inspect_dataset.py
python ml/scripts/detect_duplicates.py
python ml/scripts/build_splits.py
python ml/training/train.py                # frozen-backbone baselines
python ml/training/finetune.py --backbone efficientnet_b0
python ml/training/calibrate.py --run <run_id>
python ml/training/test_eval.py
python ml/training/export.py --run <run_id>
```

## Environment Variables

**`web/.env.local`**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | FastAPI URL, default `http://localhost:8000` |
| `NEXT_PUBLIC_USE_MOCKS` | `true` to use the mock layer, `false` to call the backend |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional, for cloud sync |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional. Use the anon/publishable key only, never the service-role key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works as a fallback name |

**Backend (all optional)**

| Variable | Purpose |
|---|---|
| `BREEDVISION_CHECKPOINT` | Full path to a `.pt` checkpoint |
| `BREEDVISION_RUNS_DIR` | Directory of training runs to search |
| `BREEDVISION_RUN` | Run id to prefer inside that directory |

**ML:** `download_dataset.py` reads `KAGGLE_USERNAME` and `KAGGLE_KEY`, or `~/.kaggle/kaggle.json`.

## How It Works

**Splitting without leakage.** Every image gets a 64-bit perceptual hash. Images within a small Hamming distance are linked, and connected components become groups (usually the same animal shot a few times). Splits are made per group, stratified by breed, so no animal shows up in both train and test. `build_splits.py` also builds a naive image-level split and counts how many near-duplicate pairs cross it, which is the evidence for doing it this way.

**Training.** Stage one extracts pooled features from a frozen pretrained backbone and trains a linear head on cached features, which is fast enough to compare several architectures on a CPU. Stage two starts from that head and unfreezes only the last few blocks of EfficientNet-B0 with augmentation.

**Confidence.** A raw softmax score isn't a probability of being right, so the head is temperature-scaled on validation data. The "confident" and "low" cut-offs are then chosen from validation results (5-fold cross-fitted) and saved inside the model bundle, so the backend and the web app always use the same thresholds as the model they're serving.

**Not cattle?** The classifier always picks some breed. To catch obviously wrong inputs, `ood.py` measures the Mahalanobis distance from a photo's features to the nearest breed mean. The cut-off is the 98th percentile of validation scores.

**Heat-maps.** Since the classifier is a backbone, global average pooling and one linear layer, Grad-CAM can be computed exactly from the final feature map and the weights of the predicted class.

## Current Limitations

- Top-1 accuracy is around 62%. Several breeds are visually very close and some have only a few dozen training images.
- The model weights and the dataset aren't in the repo, so predictions need a local checkpoint.
- `ml/config.yaml` and the backend's default runs directory use Windows paths from my machine.
- The price and sales pages run on synthetic data, not real market prices.
- `backend/main.py` still has the herd-management endpoints (animals, farmers, alerts, reports) from an earlier version. The current web app doesn't use them.
- `frontend/` is an unused Vite starter left over from that earlier version.
- I haven't deployed it anywhere yet.

## Future Improvements

- Collect more photos for the weakest breeds and retrain
- Publish the model checkpoint as a release asset so the backend works after cloning
- Move dataset paths to environment variables
- Remove the old herd-management code and the unused `frontend/` folder
- Deploy the web app and backend

## Author

Subhronil Chattoraj · GitHub: [Neilcodeshere](https://github.com/Neilcodeshere)

Breed photos are from Wikimedia Commons; each one is credited in the app. The training data is the [Indian Cattle Image Dataset](https://www.kaggle.com/datasets/atharvadarpude/indian-cattle-image-dataset) on Kaggle.
