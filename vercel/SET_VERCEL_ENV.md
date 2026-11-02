# 🔐 Set Vercel Environment Variables - COMPLETE GUIDE

## Why You're Getting "Server Error"

The login API is failing because **environment variables aren't set in Vercel**.

Your `.env` file works locally but isn't deployed to Vercel.  
You must manually set all variables in the Vercel dashboard.

---

## ✅ Step-by-Step: Set Environment Variables

### Step 1: Go to Vercel Dashboard

1. Visit: https://vercel.com/dashboard
2. Click your project: `nosih-secure`
3. Click: **Settings** tab
4. Click: **Environment Variables** (left sidebar)

---

### Step 2: Add ALL These Variables

Click "Add Variable" for each one below:

#### 🗄️ Database (Supabase) - **REQUIRED**

```bash
# Variable Name                    # Value
SUPABASE_URL                       https://gzylespyvkomphbzrvjj.supabase.co
SUPABASE_SERVICE_ROLE_KEY          eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6eWxlc3B5dmtvbXBoYnpydmpqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMjI1Nzk5NCwiZXhwIjoyMDQ3ODMzOTk0fQ.BF_hG8uTZkMrxTCuG4LsBHMuGZEKiP4HnN56tRmr89c
```

> ⚠️ **Use your actual service role key!** The one above is an example.

#### 🔐 Authentication - **REQUIRED**

```bash
JWT_SECRET                         f3dbc9c189e255e9c8fe
JWT_EXPIRES_IN                     8h
```

#### 🔒 Security Keys - **REQUIRED**

```bash
DOCUMENT_ENC_KEY                   7ae98a2507defc6594a391aaca35f69f55710f980126b8e14e7bde218966afdc
HASH_PEPPER                        342c9a0ef786abcc090c719de1135104e90413fd06ee5852edae0eb6a7db865b
```

> ⚠️ **Use YOUR keys from your .env file!** These are examples.

#### 🤖 AI (Gemini) - **REQUIRED for extraction**

```bash
GEMINI_API_KEY                     AIzaSyDk7_your_actual_key_here
GEMINI_MODEL                       gemini-3.6-flash
```

> Get your key at: https://aistudio.google.com/app/apikey

#### 📦 IPFS Storage (Pinata) - **REQUIRED**

```bash
PINATA_API_KEY                     2307b19318029d2f0889
PINATA_API_SECRET                  d7897f1675283b70b88ff8baeff4432224b2ad30a4f5d6f1089227d622adaf1c
```

> ⚠️ **Use YOUR Pinata credentials!** These are examples.

#### ⛓️ Blockchain (Polygon Amoy) - **REQUIRED**

```bash
CONTRACT_ADDRESS                   0xE5a941d9628A7d7Ab497636A204B627F29070952
ISSUER_PRIVATE_KEY                 e09b932b59c2dd9db2bbdf50b4f384187b03d05b7cbb56b16e0f3de1d6ff30c3
ISSUER_ADDRESS                     0x44726d2B6243c874725BCFB8269a2d0aa411Ea57
AMOY_RPC_URL                       https://polygon-amoy-bor-rpc.publicnode.com
CHAIN_ID                           80002
```

> ⚠️ **Use YOUR private key!** The one above is an example.

#### ⚡ Optimization Flags

```bash
NODE_ENV                           production
EXTRACTION_PARALLEL                true
EXTRACTION_BUDGET_MS               30000
VIEW_DOCUMENT_POLICY               registrar
```

---

### Step 3: Set Environment for Each Variable

When adding each variable, you can choose:
- **Production** ✅ (Always select this)
- **Preview** (optional)
- **Development** (optional)

**Recommended:** Check all three boxes for each variable.

---

### Step 4: Save and Redeploy

After adding all variables:

1. Click **Save** on each variable
2. Go to **Deployments** tab
3. Click **"..."** on latest deployment
4. Click **Redeploy**

OR use CLI:
```bash
vercel --prod
```

---

## 🧪 Test After Setting Variables

### 1. Check API Health

```bash
curl https://nosih-secure.vercel.app/api/health
```

**If variables are set correctly:**
```json
{
  "status": "ok",
  "timestamp": "2026-11-02T...",
  "config": { "ok": true },
  "database": { "ok": true }
}
```

**If variables are missing:**
```json
{
  "status": "degraded",
  "config": {
    "ok": false,
    "problems": [
      "SUPABASE_URL is not set",
      "JWT_SECRET is not set"
    ]
  }
}
```

### 2. Test Login

Visit: https://nosih-secure.vercel.app/login

**Enter:**
- Email: `admin@nosih.com`
- Password: `NOSIH123`

**Should:**
- ✅ Login successfully
- ✅ Redirect to dashboard
- ❌ NO "server error" message!

---

## 📋 Quick Copy-Paste Template

Copy your `.env` values and paste them in Vercel:

```bash
# Database
SUPABASE_URL=<from your .env>
SUPABASE_SERVICE_ROLE_KEY=<from your .env>

# Auth
JWT_SECRET=<from your .env>
JWT_EXPIRES_IN=8h

# Security
DOCUMENT_ENC_KEY=<from your .env>
HASH_PEPPER=<from your .env>

# AI
GEMINI_API_KEY=<from your .env>
GEMINI_MODEL=gemini-3.6-flash

# IPFS
PINATA_API_KEY=<from your .env>
PINATA_API_SECRET=<from your .env>

# Blockchain
CONTRACT_ADDRESS=0xE5a941d9628A7d7Ab497636A204B627F29070952
ISSUER_PRIVATE_KEY=<from your .env>
ISSUER_ADDRESS=<from your .env>
AMOY_RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com
CHAIN_ID=80002

# Optimization
NODE_ENV=production
EXTRACTION_PARALLEL=true
EXTRACTION_BUDGET_MS=30000
VIEW_DOCUMENT_POLICY=registrar
```

---

## 🔍 How to Find Your Values

### From Your Local `.env` File:

```bash
# View your .env file
cat .env

# Or on Windows PowerShell
Get-Content .env
```

Copy the values after the `=` sign for each variable.

### Get New API Keys:

1. **Gemini API Key:**
   - Visit: https://aistudio.google.com/app/apikey
   - Click "Create API Key"
   - Copy the key

2. **Pinata API Keys:**
   - Visit: https://app.pinata.cloud/developers/api-keys
   - Create new key
   - Copy API Key and API Secret

3. **Supabase Service Role Key:**
   - Visit: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
   - Copy "service_role" key (NOT anon key!)

---

## ⚠️ Common Mistakes

### Mistake 1: Using Wrong Supabase Key
❌ Don't use `anon` or `publishable` key  
✅ Must use `service_role` key (starts with `eyJ...`)

### Mistake 2: Missing Quotes in Vercel
❌ Don't add quotes in Vercel UI  
✅ Paste value directly (Vercel handles it)

### Mistake 3: Setting Only "Production"
⚠️ If testing preview deploys, also set "Preview"  
✅ Best practice: Check all three boxes

### Mistake 4: Not Redeploying After Setting Variables
❌ Variables don't apply to existing deployment  
✅ Must redeploy after adding/changing variables

---

## 🎯 After All Variables Are Set

You should be able to:

- [x] Visit homepage: https://nosih-secure.vercel.app/
- [x] Login works (no server error!)
- [x] Dashboard loads
- [x] Can navigate to Register Deed
- [x] Can upload PDF for extraction
- [x] API endpoints work

---

## 🔧 Still Getting Errors?

### Check 1: Verify Variables Are Set
```bash
# Should return all your variables
curl https://nosih-secure.vercel.app/api/health
```

### Check 2: Check Vercel Logs
1. Go to Vercel Dashboard
2. Click "Deployments"
3. Click latest deployment
4. Click "View Function Logs"
5. Look for errors mentioning missing variables

### Check 3: Redeploy
```bash
vercel --prod --force
```

---

## 📊 What Each Variable Does

| Variable | Purpose | Required For |
|----------|---------|--------------|
| `SUPABASE_URL` | Database connection | Everything |
| `SUPABASE_SERVICE_ROLE_KEY` | Database auth | Everything |
| `JWT_SECRET` | Login authentication | Login |
| `GEMINI_API_KEY` | PDF extraction | Auto-fill |
| `PINATA_API_KEY` | IPFS file storage | Registration |
| `CONTRACT_ADDRESS` | Blockchain contract | Registration |
| `ISSUER_PRIVATE_KEY` | Sign transactions | Registration |
| `DOCUMENT_ENC_KEY` | Encrypt deeds | Registration |
| `HASH_PEPPER` | Generate Land IDs | Registration |

---

## ✅ Success Checklist

After setting all variables:

- [ ] All variables added in Vercel dashboard
- [ ] Redeployed the app
- [ ] `/api/health` returns `"status":"ok"`
- [ ] Login works (no server error)
- [ ] Can access dashboard
- [ ] Can register deeds
- [ ] Extraction works

---

**Time Required:** 10-15 minutes  
**Difficulty:** Easy (copy-paste from .env)  
**Result:** Fully working app with no server errors! ✅

Your `.env` file already has all the values.  
Just copy them to Vercel dashboard and redeploy!
