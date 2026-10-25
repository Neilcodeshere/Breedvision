
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image
import numpy as np
import cv2, time, uuid, sqlite3, csv, io, json
from datetime import datetime

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

# Breed classification lives in its own module so that loading a second model
# cannot destabilise the working detection path. It fails soft internally.
import classifier

BASE = Path(__file__).resolve().parent
UPLOADS = BASE / "uploads"
ANNOTATED = BASE / "annotated"
MODEL_DIR = BASE / "models"
UPLOADS.mkdir(exist_ok=True); ANNOTATED.mkdir(exist_ok=True)
DB = BASE / "breedvision.db"

app = FastAPI(title="BreedVision Platform API", version="3.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173","http://127.0.0.1:5173",
                                 # web/ (Next.js) runs on 3000
                                 "http://localhost:3000","http://127.0.0.1:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/annotated", StaticFiles(directory=ANNOTATED), name="annotated")

CUSTOM_MODEL = MODEL_DIR / "breedvision.pt"
DEFAULT_MODEL = MODEL_DIR / "yolov8n.pt"
model = None
model_source = "not loaded"

def db():
    con=sqlite3.connect(DB); con.row_factory=sqlite3.Row; return con

def init_db():
    con=db(); cur=con.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS farmers(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, village TEXT,
      district TEXT, state TEXT, farm_id TEXT, animals INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS animals(
      id TEXT PRIMARY KEY, species TEXT NOT NULL, breed TEXT, farmer TEXT, age TEXT,
      gender TEXT, location TEXT, status TEXT DEFAULT 'Active', confidence REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS detections(
      id INTEGER PRIMARY KEY AUTOINCREMENT, animal_id TEXT, species TEXT, breed TEXT,
      confidence REAL, location TEXT, model TEXT, inference_ms REAL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts(
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, title TEXT, message TEXT,
      severity TEXT, read INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings(
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    """)
    if cur.execute("SELECT COUNT(*) FROM farmers").fetchone()[0] == 0:
        now=datetime.now().isoformat()
        cur.executemany("INSERT INTO farmers(name,phone,village,district,state,farm_id,animals,created_at) VALUES(?,?,?,?,?,?,?,?)",[
            ("Rajesh Kumar","9876543210","Anand","Anand","Gujarat","FARM-001",24,now),
            ("Amit Singh","9876501234","Hisar","Hisar","Haryana","FARM-002",18,now),
            ("Sunil Patil","9822001122","Pune","Pune","Maharashtra","FARM-003",31,now)])
    if cur.execute("SELECT COUNT(*) FROM animals").fetchone()[0] == 0:
        now=datetime.now().isoformat()
        rows=[("IND000125","Cow","Gir","Rajesh Kumar","4","Female","Anand, Gujarat","Active",97.8,now),
              ("IND000124","Buffalo","Murrah","Amit Singh","5","Female","Hisar, Haryana","Active",96.2,now),
              ("IND000123","Cow","Sahiwal","Sunil Patil","3","Female","Pune, Maharashtra","Active",94.1,now)]
        cur.executemany("INSERT INTO animals VALUES(?,?,?,?,?,?,?,?,?,?)",rows)
    if cur.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] == 0:
        now=datetime.now().isoformat()
        cur.executemany("INSERT INTO alerts(type,title,message,severity,read,created_at) VALUES(?,?,?,?,?,?)",[
          ("LOW CONFIDENCE","Low confidence prediction","Animal IND000123 received a 54.2% breed prediction.","warning",0,now),
          ("SYSTEM","AI model ready","Detection API and YOLO model are online.","info",0,now),
          ("REVIEW","Manual review required","An uncertain breed result is waiting for verification.","critical",0,now)])
    con.commit(); con.close()

def load_model():
    global model, model_source
    if YOLO is None: return
    path=CUSTOM_MODEL if CUSTOM_MODEL.exists() else DEFAULT_MODEL
    try:
        model=YOLO(str(path)); model_source=path.name
    except Exception as e:
        model=None; model_source=f"load error: {e}"

@app.on_event("startup")
def startup():
    init_db(); load_model()
    st = classifier.load()
    print(f"[classifier] available={st.available} source={st.source} {st.detail}")

@app.get("/api/health")
def health():
    con=db()
    counts={k:con.execute(q).fetchone()[0] for k,q in {
        "animals":"SELECT COUNT(*) FROM animals","farmers":"SELECT COUNT(*) FROM farmers",
        "detections":"SELECT COUNT(*) FROM detections","alerts":"SELECT COUNT(*) FROM alerts WHERE read=0"}.items()}
    con.close()
    cls = classifier.status()
    return {"status":"online","model":model_source,"database":"connected",
            "classifier":{"available":cls.available,"source":cls.source,
                          "model_version":cls.model_version,
                          "num_classes":cls.num_classes,"detail":cls.detail},
            **counts}

@app.get("/api/dashboard")
def dashboard():
    con=db()
    total=con.execute("SELECT COUNT(*) FROM animals").fetchone()[0]
    farmers=con.execute("SELECT COUNT(*) FROM farmers").fetchone()[0]
    scans=con.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
    avg=con.execute("SELECT COALESCE(AVG(confidence),0) FROM detections").fetchone()[0]
    cattle=con.execute("SELECT COUNT(*) FROM animals WHERE lower(species)='cow'").fetchone()[0]
    buffalo=con.execute("SELECT COUNT(*) FROM animals WHERE lower(species)='buffalo'").fetchone()[0]
    alerts=con.execute("SELECT COUNT(*) FROM alerts WHERE read=0").fetchone()[0]
    breeds=[dict(r) for r in con.execute("SELECT COALESCE(breed,'Unknown') breed, COUNT(*) count FROM animals GROUP BY breed ORDER BY count DESC").fetchall()]
    recent=[dict(r) for r in con.execute("SELECT animal_id,species,breed,confidence,location,created_at FROM detections ORDER BY id DESC LIMIT 8").fetchall()]
    con.close()
    return {"total_animals":total,"farmers":farmers,"scans":scans,"avg_confidence":round(avg,1),
            "cattle":cattle,"buffalo":buffalo,"alerts":alerts,"breeds":breeds,"recent":recent}

@app.get("/api/animals")
def animals():
    con=db(); rows=[dict(r) for r in con.execute("SELECT * FROM animals ORDER BY created_at DESC").fetchall()]; con.close(); return rows

@app.post("/api/animals")
def add_animal(data:dict):
    aid=data.get("id") or f"IND{uuid.uuid4().hex[:8].upper()}"
    now=datetime.now().isoformat()
    con=db()
    con.execute("INSERT INTO animals VALUES(?,?,?,?,?,?,?,?,?,?)",(aid,data.get("species","Cow"),data.get("breed","Unknown"),data.get("farmer",""),data.get("age",""),data.get("gender","Female"),data.get("location",""),data.get("status","Active"),float(data.get("confidence",0)),now))
    con.commit(); row=con.execute("SELECT * FROM animals WHERE id=?",(aid,)).fetchone(); con.close(); return dict(row)

@app.patch("/api/animals/{aid}")
def update_animal(aid:str,data:dict):
    con=db(); row=con.execute("SELECT * FROM animals WHERE id=?",(aid,)).fetchone()
    if not row: raise HTTPException(404,"Animal not found")
    allowed=["species","breed","farmer","age","gender","location","status","confidence"]
    vals={k:data[k] for k in allowed if k in data}
    if vals:
        sets=", ".join(f"{k}=?" for k in vals); con.execute(f"UPDATE animals SET {sets} WHERE id=?",(*vals.values(),aid)); con.commit()
    row=con.execute("SELECT * FROM animals WHERE id=?",(aid,)).fetchone(); con.close(); return dict(row)

@app.delete("/api/animals/{aid}")
def delete_animal(aid:str):
    con=db(); con.execute("DELETE FROM animals WHERE id=?",(aid,)); con.commit(); con.close(); return {"ok":True}

@app.get("/api/farmers")
def farmers():
    con=db(); rows=[dict(r) for r in con.execute("SELECT * FROM farmers ORDER BY id DESC").fetchall()]; con.close(); return rows

@app.post("/api/farmers")
def add_farmer(data:dict):
    con=db(); now=datetime.now().isoformat()
    cur=con.execute("INSERT INTO farmers(name,phone,village,district,state,farm_id,animals,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (data.get("name",""),data.get("phone",""),data.get("village",""),data.get("district",""),data.get("state",""),data.get("farm_id",""),int(data.get("animals",0)),now))
    con.commit(); row=con.execute("SELECT * FROM farmers WHERE id=?",(cur.lastrowid,)).fetchone(); con.close(); return dict(row)

@app.get("/api/alerts")
def alerts():
    con=db(); rows=[dict(r) for r in con.execute("SELECT * FROM alerts ORDER BY read ASC,id DESC").fetchall()]; con.close(); return rows

@app.patch("/api/alerts/{alert_id}/read")
def mark_alert(alert_id:int):
    con=db(); con.execute("UPDATE alerts SET read=1 WHERE id=?",(alert_id,)); con.commit(); con.close(); return {"ok":True}

@app.get("/api/reports/csv")
def report_csv():
    con=db(); rows=con.execute("SELECT animal_id,species,breed,confidence,location,model,inference_ms,created_at FROM detections ORDER BY id DESC").fetchall(); con.close()
    out=io.StringIO(); w=csv.writer(out); w.writerow(["Animal ID","Species","Breed","Confidence","Location","Model","Inference ms","Timestamp"])
    for r in rows: w.writerow(list(r))
    from fastapi.responses import Response
    return Response(out.getvalue(),media_type="text/csv",headers={"Content-Disposition":"attachment; filename=breedvision_report.csv"})

@app.get("/api/analytics")
def analytics():
    con=db()
    by_species=[dict(r) for r in con.execute("SELECT species name,COUNT(*) count FROM animals GROUP BY species").fetchall()]
    by_breed=[dict(r) for r in con.execute("SELECT COALESCE(breed,'Unknown') name,COUNT(*) count FROM animals GROUP BY breed ORDER BY count DESC").fetchall()]
    trend=[dict(r) for r in con.execute("SELECT substr(created_at,1,10) date,COUNT(*) count,ROUND(AVG(confidence),1) confidence FROM detections GROUP BY date ORDER BY date").fetchall()]
    con.close(); return {"by_species":by_species,"by_breed":by_breed,"trend":trend}

@app.get("/api/settings")
def get_settings():
    con=db(); rows=con.execute("SELECT key,value FROM settings").fetchall(); con.close()
    data={r["key"]:json.loads(r["value"]) for r in rows}
    defaults={"confidence_threshold":60,"auto_detection":True,"email_alerts":True,"critical_alerts":True,"low_confidence_alerts":True,"show_confidence":True}
    defaults.update(data); return defaults

@app.put("/api/settings")
def save_settings(data:dict):
    con=db()
    for k,v in data.items(): con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",(k,json.dumps(v)))
    con.commit(); con.close(); return {"ok":True}

@app.post("/api/detect")
async def detect(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"): raise HTTPException(400,"Please upload an image file.")
    raw=await file.read()
    if len(raw)>10*1024*1024: raise HTTPException(413,"Image is larger than 10 MB.")
    try: image=Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception: raise HTTPException(400,"Invalid image.")
    if model is None: raise HTTPException(503,"YOLO model is not loaded.")
    arr=np.array(image); start=time.perf_counter()
    results=model.predict(source=arr,conf=0.25,verbose=False); elapsed=round((time.perf_counter()-start)*1000,1)
    result=results[0]; names=result.names; detections=[]
    for box in result.boxes:
        cls_id=int(box.cls[0]); conf=round(float(box.conf[0])*100,1)
        xyxy=[int(v) for v in box.xyxy[0].tolist()]
        class_name=names[cls_id] if isinstance(names,dict) else names[cls_id]
        breed=class_name if CUSTOM_MODEL.exists() and class_name.lower() not in {"cow","buffalo","cattle"} else None
        detections.append({"class_name":class_name,"breed":breed,"confidence":conf,"bbox":xyxy})
    annotated=result.plot(); out_name=f"{uuid.uuid4().hex}.jpg"; cv2.imwrite(str(ANNOTATED/out_name),annotated)
    best=max((d["confidence"] for d in detections),default=0.0); aid=f"IND{uuid.uuid4().hex[:8].upper()}"
    con=db()
    for d in detections:
        species="Buffalo" if d["class_name"].lower()=="buffalo" else "Cow" if d["class_name"].lower()=="cow" else d["class_name"]
        con.execute("INSERT INTO detections(animal_id,species,breed,confidence,location,model,inference_ms,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (aid,species,d["breed"] or "Unknown",d["confidence"],"Uploaded Image",model_source,elapsed,datetime.now().isoformat()))
    if detections:
        d=detections[0]; species="Buffalo" if d["class_name"].lower()=="buffalo" else "Cow"
        con.execute("INSERT OR REPLACE INTO animals VALUES(?,?,?,?,?,?,?,?,?,?)",(aid,species,d["breed"] or "Unknown","AI Detector","","", "Uploaded Image","Active",d["confidence"],datetime.now().isoformat()))
        if d["confidence"] < 60:
            con.execute("INSERT INTO alerts(type,title,message,severity,read,created_at) VALUES(?,?,?,?,?,?)",
                        ("LOW CONFIDENCE","Low confidence detection",f"{aid} received {d['confidence']}% confidence. Review recommended.","warning",0,datetime.now().isoformat()))
    con.commit(); con.close()
    return {"animal_id":aid,"model":model_source,"confidence":best,"inference_ms":elapsed,"detections":detections,"annotated_url":f"/annotated/{out_name}"}

@app.get("/api/classify/info")
def classify_info():
    cls = classifier.status()
    return {
        "available": cls.available,
        "source": cls.source,
        "detail": cls.detail,
        "model_version": cls.model_version,
        "num_classes": cls.num_classes,
        "task": "breed classification (49 Indian cattle breeds)",
        "thresholds": classifier.active_thresholds(),
    }

@app.post("/api/classify")
async def classify(file: UploadFile = File(...), top_k: int = 5):
    """Predict the breed of a single animal image.

    Distinct from /api/detect: that route localises animals with YOLO and
    returns boxes; this one names the breed with the trained classifier. They
    answer different questions and are deliberately kept separate.
    """
    cls = classifier.status()
    if not cls.available:
        raise HTTPException(503, f"Breed classifier unavailable. {cls.detail}")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Please upload an image file.")
    raw = await file.read()
    if len(raw) > 10*1024*1024:
        raise HTTPException(413, "Image is larger than 10 MB.")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(400, "That image could not be opened. It may be damaged.")

    try:
        result = classifier.classify(image, top_k=max(1, min(top_k, 10)))
    except Exception as exc:
        raise HTTPException(500, f"Classification failed: {type(exc).__name__}")

    # Record it the same way detections are recorded, so the dashboard and
    # analytics endpoints see classifications too. Species is fixed: the
    # training set contains cattle only (docs/dataset-report.md section 7.4).
    aid = f"IND{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now().isoformat()
    con = db()
    con.execute(
        "INSERT INTO detections(animal_id,species,breed,confidence,location,model,inference_ms,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (aid, "Cow", result["breed_name"], round(result["confidence"]*100, 1),
         "Uploaded Image", result["model_version"], result["inference_ms"], now))
    # Only record a named breed on the animal when the model is actually
    # confident. Storing a hedged guess as fact is how a maybe becomes a
    # record nobody questions later.
    con.execute(
        "INSERT OR REPLACE INTO animals VALUES(?,?,?,?,?,?,?,?,?,?)",
        (aid, "Cow", result["breed_name"] if result["is_confident"] else "Unknown",
         "AI Classifier", "", "", "Uploaded Image", "Active",
         round(result["confidence"]*100, 1), now))
    if not result["is_confident"]:
        con.execute(
            "INSERT INTO alerts(type,title,message,severity,read,created_at) VALUES(?,?,?,?,?,?)",
            ("LOW CONFIDENCE", "Breed not confidently identified",
             f"{aid} returned {round(result['confidence']*100,1)}% for "
             f"{result['breed_name']}. Recorded as Unknown pending review.",
             "warning", 0, now))
    con.commit(); con.close()

    return {"animal_id": aid, **result}


@app.post("/api/explain")
async def explain_prediction(file: UploadFile = File(...)):
    """Heat-map of where the classifier found evidence for its predicted breed.

    Explains the model's own top prediction, which may be wrong: it describes
    what the model did, not whether it was right. Nothing is stored.
    """
    cls = classifier.status()
    if not cls.available:
        raise HTTPException(503, f"Breed classifier unavailable. {cls.detail}")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Please upload an image file.")
    raw = await file.read()
    if len(raw) > 10*1024*1024:
        raise HTTPException(413, "Image is larger than 10 MB.")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(400, "That image could not be opened. It may be damaged.")
    try:
        return classifier.explain(image)
    except Exception as exc:
        raise HTTPException(500, f"Explanation failed: {type(exc).__name__}")
