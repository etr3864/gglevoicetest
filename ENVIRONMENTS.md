# סביבות הפרויקט — Production & Staging

## סקירה כללית

הפרויקט רץ בשתי סביבות מבודדות לחלוטין.  
אין שום חפיפה בנתונים — כל שינוי בסביבה אחת לא משפיע על השנייה.

---

## Production

| רכיב | כתובת / ערך |
|---|---|
| Frontend | https://voiceapp.0ptive.com |
| Backend API | https://voiceapi.0ptive.com |
| Branch | `main` |
| GKE Namespace | `default` |
| Cloud SQL Instance | `voice-db` → IP פרטי: `10.33.1.3` |
| Database Name | `voice_db` |
| Redis | `10.224.75.131:6379` |
| GCS Recordings | `voice-ai-recordings-gen-lang-0546829339` |
| GCS Knowledge | `voice-ai-knowledge-gen-lang-0546829339` |
| GCS Media | `voice-ai-media-gen-lang-0546829339` |
| K8s Secret | `voice-api-secrets` |
| Telnyx App ID | `2899429708024252053` |
| Deploy | אוטומטי — כל push ל-`main` |

---

## Staging

| רכיב | כתובת / ערך |
|---|---|
| Frontend | https://staging.voiceapp.0ptive.com |
| Backend API | https://staging.voiceapi.0ptive.com |
| Branch | `staging` |
| GKE Namespace | `staging` |
| Cloud SQL Instance | `voice-staging` → IP ציבורי: `136.115.122.253` |
| Database Name | `voice_staging` |
| Redis | `10.176.111.211:6379` |
| GCS Recordings | `voice-ai-recordings-staging` |
| GCS Knowledge | `voice-ai-knowledge-staging` |
| GCS Media | `voice-ai-media-staging` |
| K8s Secret | `api-secrets` |
| Telnyx App ID | `23939377523298928319` |
| Static IP | `35.241.15.66` |
| Deploy | אוטומטי — כל push ל-`staging` |

**משתמש ראשון בstaging:**
- Email: `staging.eytan@0ptive.com`
- Password: `30032003`
- Role: `super_admin`

---

## ארכיטקטורת הבידוד

```
GitHub Repository
├── branch: main     ──→  GitHub Action: deploy.yml          ──→  GKE namespace: default  (PRODUCTION)
└── branch: staging  ──→  GitHub Action: deploy-staging.yml  ──→  GKE namespace: staging  (STAGING)

GCP Infrastructure
├── Cloud SQL
│   ├── voice-db       (production — private IP, VPC only)
│   └── voice-staging  (staging — public IP, authorized networks)
├── Redis (Memorystore)
│   ├── 10.224.75.131  (production)
│   └── 10.176.111.211 (staging)
└── GCS Buckets
    ├── voice-ai-*-gen-lang-0546829339  (production)
    └── voice-ai-*-staging              (staging)
```

---

## GitHub Actions

### `deploy.yml` — Production
- מופעל על: `push` ל-`main`
- בונה image: `voice-api:<sha>` + `voice-api:latest`
- מפעיל: `kubectl apply -f k8s/deployment.yaml` על namespace `default`

### `deploy-staging.yml` — Staging
- מופעל על: `push` ל-`staging`
- בונה image: `voice-api:staging-<sha>` + `voice-api:staging`
- מפעיל: `kubectl apply -f k8s/staging/` על namespace `staging`

לראות deployments בפועל: https://github.com/etr3864/gglevoicetest/actions

---

## קבצי K8s

```
k8s/
├── deployment.yaml   ← Production deployment
├── service.yaml      ← Production service, ingress, certificate
├── hpa.yaml          ← Production auto-scaling (1–10 pods)
└── staging/
    ├── deployment.yaml   ← Staging deployment (pod יחיד, ללא HPA)
    └── service.yaml      ← Staging service, ingress, certificate
```

**הבדלים עיקריים בין production לstaging:**
- Staging: resource limits נמוכים יותר (cpu: 500m, memory: 512Mi)
- Staging: אין HPA — pod יחיד תמיד
- Staging: `prisma db push` (במקום `migrate deploy`) לסנכרון schema
- Staging: כל ה-env vars מצביעים על תשתית staging בלבד

---

## DNS (Namecheap — 0ptive.com)

| Record | Host | Value | סביבה |
|---|---|---|---|
| CNAME | `voiceapp` | Vercel DNS | Production Frontend |
| A | `voiceapi` | IP של production Ingress | Production Backend |
| CNAME | `staging.voiceapp` | Vercel DNS | Staging Frontend |
| A | `staging.voiceapi` | `35.241.15.66` | Staging Backend |

---

## Vercel — Frontend

פרויקט: `gglevoicetest-web`

| Environment | Branch | VITE_API_URL |
|---|---|---|
| Production | `main` | `https://voiceapi.0ptive.com` |
| Preview (staging) | `staging` | `https://staging.voiceapi.0ptive.com` |

---

## איך לעבוד נכון

### פיתוח פיצ'ר חדש

```bash
# 1. וודא שאתה על staging
git checkout staging

# 2. כתוב קוד

# 3. דחוף ל-staging
git add .
git commit -m "feat: תיאור הפיצ'ר"
git push origin staging
# → staging מתעדכן אוטומטית תוך ~3-4 דקות
```

### בדיקה ב-staging

1. כנס ל-https://staging.voiceapp.0ptive.com
2. התחבר עם פרטי staging
3. בדוק שהפיצ'ר עובד
4. בדוק שלא נשבר שום דבר קיים

### העלאה לproduction

```bash
# רק אחרי שבדקת ב-staging וכל הכל תקין
git checkout main
git merge staging
git push origin main
# → production מתעדכן אוטומטית
```

---

## בדיקות שימושיות

```bash
# סטטוס pods
kubectl get pods -n default        # production
kubectl get pods -n staging        # staging

# לוגים בזמן אמת
kubectl logs -n default -l app=voice-api -f
kubectl logs -n staging -l app=voice-api-staging -f

# לוגים של initContainer (schema sync)
kubectl logs -n staging -l app=voice-api-staging -c migrate

# Ingress ו-IPs
kubectl get ingress -n default
kubectl get ingress -n staging
```

---

## GCP Project

- **Project ID:** `gen-lang-client-0546829339`
- **Region:** `us-central1`
- **GKE Cluster:** `voice-ai-cluster-us`
- **Docker Registry:** `me-west1-docker.pkg.dev/gen-lang-client-0546829339/voice-ai`
