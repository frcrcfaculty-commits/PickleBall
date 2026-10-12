# Your steps — written so nothing can be misread

Everything here is something an agent is **not allowed** or **not able** to do:
logging in with your passwords, holding a phone, paying, signing.
Do the parts in order. Each step says what you should see. If you see something
different, do the "If it looks different" line. Nothing else.

| Part | When | Time |
|---|---|---|
| A. Log in the tools (Mac + Windows) | today, first | 30–45 min |
| B. Start the three agents | today, right after A | 10 min |
| C. Phone check | when Hermes sends you a link (same day) | 5 min |
| D. Watching | every day after | 2 min per digest |
| E. Accounts and the court | only when a digest asks | later |

---

## PART A — Log in the tools (one time only)

### A1. On the M3 Max Mac (Antigravity and Gemini will work here)

1. Press **Command + Space** together. A search box appears in the middle of the screen.
2. Type **Terminal** and press **Enter**. A white or black window with text opens. This is the Terminal.
3. Click inside the Terminal window. Type this and press **Enter**:
   ```
   brew --version
   ```
   - You should see a line like `Homebrew 4.x.x`.
   - **If it looks different** (it says `command not found`): open **https://brew.sh** in Safari, copy the
     one long line shown under "Install Homebrew", paste it into Terminal, press **Enter**, type your Mac
     password when asked (letters will not show while you type — that is normal), press **Enter**, and wait
     until it finishes. Then do step 3 again.
4. Type this and press **Enter** (installs GitHub tool, Node and Git):
   ```
   brew install gh node git
   ```
   Wait until the Terminal shows a new empty line where you can type again (1–5 minutes).
5. Type this and press **Enter**:
   ```
   gh auth login
   ```
   It asks you 4 questions. Use the **arrow keys** to move and **Enter** to choose:
   - "Where do you use GitHub?" → choose **GitHub.com**
   - "What is your preferred protocol?" → choose **HTTPS**
   - "Authenticate Git with your GitHub credentials?" → type **Y**, press **Enter**
   - "How would you like to authenticate?" → choose **Login with a web browser**
   
   It now shows a code like `ABCD-1234`. **Write it down or keep the window visible.** Press **Enter**.
   Safari opens a GitHub page. Type the code into the boxes, click **Continue**, then click **Authorize github**.
   Go back to Terminal. You should see `✓ Logged in as …`.
6. Type this and press **Enter**:
   ```
   gh auth status
   ```
   You should see `Logged in to github.com account frcrcfaculty-commits`.
   - **If it shows a different account name**: type `gh auth logout`, press **Enter**, then do step 5 again,
     and in Safari sign in with the GitHub account that owns the PickleBall repository.
7. Type this and press **Enter** (installs the Vercel tool):
   ```
   npm install -g vercel
   ```
   - **If it says `permission denied` / `EACCES`**: type `sudo npm install -g vercel`, press **Enter**,
     type your Mac password (invisible), press **Enter**.
8. Type this and press **Enter**:
   ```
   vercel login
   ```
   Use the arrow keys to choose **Continue with GitHub**, press **Enter**. Safari opens. Click **Authorize** /
   **Continue** if asked. Back in Terminal you should see `Congratulations! You are now logged in.`
9. Type this and press **Enter**:
   ```
   npx supabase login
   ```
   If it asks `Ok to proceed? (y)`, type **y** and press **Enter**. Press **Enter** again when it says
   it will open the browser. In Safari, sign in to Supabase (use **Continue with GitHub**), then click
   **Authorize**. If the page shows a short code, check it matches the one in Terminal.
   Terminal should say `You are now logged in.`
10. Type this and press **Enter** (installs Gemini CLI):
    ```
    npm install -g @google/gemini-cli
    ```
    (use `sudo` in front if it says permission denied, same as step 7)
11. Type this and press **Enter** to get the two work folders ready:
    ```
    git clone https://github.com/frcrcfaculty-commits/PickleBall.git ~/pj-antigravity
    git clone https://github.com/frcrcfaculty-commits/PickleBall.git ~/pj-gemini
    ```
    You should see `Cloning into …` and `done.` twice. Leave the Terminal open.

### A2. On the i9 Windows computer (Hermes works here)

1. Press the **Windows key**, type **PowerShell**, click **Windows PowerShell**. A blue or black window opens.
2. Type each line below, press **Enter** after each, and wait until it finishes before typing the next.
   If a window pops up asking "Do you want to allow this app to make changes", click **Yes**.
   ```
   winget install --id Git.Git -e
   winget install --id GitHub.cli -e
   winget install --id OpenJS.NodeJS.LTS -e
   ```
   - **If it asks** "Do you agree to all the source agreements terms?", type **Y** and press **Enter**.
3. **Close the PowerShell window** (click the X) and open it again exactly like step 1.
   (This is needed so Windows sees the new tools.)
4. Do the same logins as on the Mac. Type each, press **Enter**, follow the same answers as A1 steps 5–9:
   ```
   gh auth login
   gh auth status
   npm install -g vercel
   vercel login
   npx supabase login
   ```
   (No `sudo` on Windows. If `npm install -g vercel` says permission denied: close PowerShell, right-click
   **Windows PowerShell** in the Start menu → **Run as administrator**, and type it again.)
5. Get Hermes's work folder ready:
   ```
   git clone https://github.com/frcrcfaculty-commits/PickleBall.git $HOME\pj-hermes
   ```

### A3. Give Hermes its own Claude API key (required — do not use your Claude subscription login)

Using your Claude.ai subscription login inside Hermes breaks Anthropic's terms. Hermes must use an API key.

1. Open **https://console.anthropic.com** in your browser. Sign in with **hansalgandhi@gmail.com**.
2. Find **Billing** (or **Plans & Billing**) in the left menu. Click **Buy credits** / **Add funds**.
   Add **$20**. (This is pay-per-use. Hermes's work here should cost a few dollars.)
3. Find **API Keys** in the left menu. Click **Create Key**. Name it **hermes-picklejudge**. Click **Create**.
4. A long text starting with `sk-ant-` appears. Click **Copy**. **It is shown only once.**
5. Open Hermes on the Windows computer. In its settings/config, where it asks for the **Anthropic API key**,
   paste the key and save. If Hermes asks for a model, choose the newest **Claude** model in the list.
   - **If Hermes is currently signed in with your Claude.ai login**: sign that out in Hermes, then paste the key.
6. Never paste this key into a chat, a GitHub file, or a message.

**Part A is done when:** `gh auth status` says logged in on both computers, and Hermes has the API key.

---

## PART B — Start the three agents

Open the file **PickleJudge-agent-prompts.md** (also at `docs/agents/PROMPTS.md` in the repo).
Each prompt sits between two lines of three backticks ```` ``` ````. When a step says "copy PROMPT 3", copy
**everything between those two lines** — not the backtick lines themselves.

### B1. Hermes first (it deploys the website the others need)

1. On the Windows computer, open Hermes.
2. Copy **PROMPT 3 — HERMES**. Paste it into Hermes's chat box. Press **Enter** / **Send**.
3. If Hermes asks permission to run a command or use the browser, click **Allow** / type **yes**.
4. If Hermes messages you "run: <some command>", it means one login in Part A did not work.
   Open PowerShell, type exactly what it says, press **Enter**, follow the browser login, then reply **done**.

### B2. Antigravity (on the Mac)

1. Open the **Antigravity** app.
2. Click **File** → **Open Folder…** → in the window, click your home folder (the house icon with your
   name) → click **pj-antigravity** → click **Open**.
3. Open the Agent panel (the chat area). In its **model selector**, choose **Claude Opus 5**.
4. Copy **PROMPT 1 — ANTIGRAVITY**. Paste it into the chat box. Press **Enter**.
5. Whenever it asks to run a terminal command, click **Accept** / **Run** (or turn on auto-run in its settings
   so it stops asking).

### B3. Gemini CLI (on the Mac, a NEW Terminal window)

1. In the Mac Terminal, press **Command + N** to open a new window.
2. Type these and press **Enter** after each:
   ```
   cd ~/pj-gemini
   gemini --yolo
   ```
   (`--yolo` lets it run commands without asking you every time. It only works inside this folder's project.)
3. The first time, it asks how to sign in: choose **Login with Google**, sign in with
   **hansalgandhi@gmail.com** in the browser that opens, then come back to Terminal.
4. Type **/model** and press **Enter**. Use the arrow keys to choose **Gemini 3.8 Flash**. Press **Enter**.
5. Copy **PROMPT 2 — GEMINI**. Paste it into the Terminal. Press **Enter**.
6. Later, when you see `LANDED: PJ-VAL-01`, type **/model**, choose **Gemini 3.1 Pro**, press **Enter**,
   then type: `Continue with PJ-VAL-02 exactly as your prompt says.` and press **Enter**.

**Part B is done when:** all three are working and none is waiting for you.
You can close the laptop lid **only after** an agent prints `LANDED` — closing it earlier pauses that agent.

---

## PART C — Phone check (when Hermes sends you a link)

Hermes will message you a link ending in **/spike.html**. Do this on **both** phones.

### C1. iPhone Air
1. Tap the link. It opens in **Safari**.
   - **If it opens inside another app** (WhatsApp/Telegram): press and hold the link → tap **Open in Safari**.
2. Tap the big white button **Run check**.
3. A box says the page "would like to access the camera". Tap **Allow**.
   - **If no box appears and nothing happens**: open the **Settings** app → **Apps** → **Safari** →
     **Camera** → choose **Allow** → go back to Safari and tap **Run check** again.
4. Point the back camera at your hand and **slowly wave it** for the whole time. Keep the screen on.
   Do not switch apps. It runs about **25 seconds**. The picture may go black for a moment two times —
   that is normal (it is changing the camera setting).
5. At the end you see lines with **PASS** in green or **FAIL** in red, and a last line **VERDICT**.
6. Tap **Copy report**. Open **WhatsApp** → your own chat ("Message yourself") → press and hold the text box →
   **Paste** → **Send**. (Backup copy. Hermes also receives it automatically.)

### C2. Razr
1. Open the phone fully (big screen). Tap the same link. It opens in **Chrome**.
2. Tap **Run check** → when asked, tap **Allow** / **While using the app**.
   - **If no camera request appears**: tap the small icon left of the web address → **Permissions** →
     **Camera** → **Allow**, then reload the page and tap **Run check**.
3. Do steps 4–6 from C1 exactly the same way.

**Part C is done when:** both phones showed a VERDICT line. Reply to Hermes: **done, both phones**.

---

## PART D — Watching (every day)

1. Hermes sends one short digest every 2 hours, and only when something changed.
2. **If the digest has no question for you: do nothing.**
3. **If it asks a yes/no question:** reply **yes** or **no**. That is all.
4. Want to see progress yourself? Open
   **https://github.com/frcrcfaculty-commits/PickleBall/blob/main/TASKS.md** — look at the **Status** column.
   `LANDED` = finished and safely on GitHub. `blocked: …` = the agent is stuck; the digest will say what it needs.
5. **If an agent window just stops** (out of credits, or it says it finished one task and waits):
   type this into that agent and press **Enter**:
   ```
   Continue with the next task in your prompt that is not LANDED in TASKS.md. Follow AGENTS.md. Finish with land.sh.
   ```
6. **If an agent window was closed or crashed:** open it again in the same folder (pj-antigravity /
   pj-gemini / pj-hermes), paste the **same prompt** again, and add this line at the end before sending:
   ```
   RESUME: read TASKS.md on origin/main and continue your first task that is not LANDED.
   ```
7. Never do the agents' work yourself, never merge anything on GitHub by hand, never click "Merge pull request".
   The merging happens by itself.

---

## PART E — Later (only when a digest says "time for E1" or "time for E2")

### E1. Store accounts (H-03) — needs your ID and a card
**Apple**
1. On the iPhone, install the **Apple Developer** app from the App Store.
2. Open it → **Account** → sign in with your Apple Account → tap **Enroll Now**.
3. Choose **Individual** (fast) — or **Organization** only if your company is registered and has a D-U-N-S number.
4. Take a photo of your ID when asked, pay the yearly fee (shown in rupees), and wait for the
   "Welcome to the Apple Developer Program" email (1–2 days).
5. Reply to Hermes: **Apple done**.

**Google Play**
1. Open **https://play.google.com/console/signup** on a computer. Sign in with **hansalgandhi@gmail.com**.
2. If your business is registered by then, choose **Organization** — this skips the rule that needs
   12 testers for 14 days. Otherwise choose **Personal**.
3. Pay the one-time $25 fee, upload your ID photo when asked, and wait for the verification email.
4. Reply to Hermes: **Play done**.

### E2. Court day (H-04) — half a day
You will get a separate checklist in the same style before this day. What to collect in advance:
2 tripods that reach 2.5–2.8 m (or poles + phone clamps), both phones fully charged + 2 power banks,
a small tin of talcum powder, a 10 m measuring tape, 4 balls, and one helper.
