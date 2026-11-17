# 期末分組｜未來實習機會

車輛一B、機械一B的分組與報告日期登記。學生由一位代表填寫組員學號、選出組長與報告日期；老師登入管理後決定開放哪一班。

學生入口：https://jush-website.github.io/End_grouping/

## 架構

GitHub Pages提供頁面，Google Apps Script負責驗證、鎖定名額與寫入原本Google Sheet。前端不顯示Apps Script頁面的提示列；管理密碼與學生名單不放在此儲存庫。

前端以隱藏表單POST連接Apps Script，回應使用postMessage；不需要瀏覽器第三方儲存權限。每次回應須通過識別碼、來源與所屬框架檢查。管理者登入只保留在目前頁面記憶體，重新整理後須重新登入。

## 第一次接上目前的Google後端

1. 從原試算表開啟「擴充功能 → Apps Script」。
2. 按「＋ → 指令碼」，新增 `GithubEndpoint`，貼入 `apps-script/github-endpoint.gs` 的完整內容。
3. 原本的後端程式與Index保留，不需重跑setup。若目前程式已含doPost，請更新該函式而不是重複新增。
4. 儲存後，選「部署 → 管理部署作業 → 鉛筆 → 新增版本 → 部署」，維持既有exec網址、執行身分「我」、存取權「所有人」。
5. 回到GitHub Pages學生入口，確認能讀取班級、登入老師管理與登記。

`apps-script/Code.gs` 是包含全部後端的編譯版本。既有專案只需新增GithubEndpoint；如改成完整替換Code.gs，請勿同時再保留另一份doPost。原有Google網址仍可作為備用入口。

## 規則

- 車輛一B：37人，日期名額5／5／3，每組1～3人。全班共用1組單人或2組雙人，其餘3人。
- 機械一B：49位有效學生，日期名額6／6／4；3人為原則，全班唯一4人組先搶先贏，取消後釋出。
- 日期為2026年12月16、23、30日。停用學生不能分組，學號不得跨班或重複加入。
- 登記、取消、日期調整與老師設定在後端驗證。共享ScriptLock避免同時搶到最後一個名額；請求識別碼避免重複送出。
- 一次開放一班。原試算表內的「期末分組」集中存放紀錄，原班級工作表只讀取姓名與學號。

## GitHub Pages設定

Settings → Pages → Deploy from a branch → main → /docs。

產生後的docs目錄已提交，不需要Actions安裝依賴；推送docs更新後由GitHub Pages部署。頁面提供的只有前端檔案，資料仍儲存在私人的Google Sheet。

## 開發

使用Node.js 22以上，不需安裝套件。

```
npm test
npm run build
```

- `public/`：原始畫面、樣式與互動。
- `github-pages/api.js`：GitHub頁面的資料連線。
- `worker/domain.mjs`：共用分組規則。
- `apps-script/server.gs`：Google後端；`github-endpoint.gs`為POST入口。
- `apps-script/Code.gs`、`Index.html`：產生的Google部署檔案。
- `docs/`：GitHub Pages部署內容。

前端自動更新約每65秒一次，同一瀏覽器的請求依序送出，相同查詢合併。Google Apps Script配額仍適用，GitHub提供前端不會取消Google後端的服務限制。

## 驗證範圍

本機測試涵蓋分組規則、唯一4人組、名額釋出、登入授權、重送保護、工作表寫入範圍、POST回傳與文字跳脫。瀏覽器模擬已驗證跨來源巢狀框架回應與偽造回應拒絕。

GitHub正式入口與Google實際資料的完整測試，需要先完成上方Google後端更新；本機模擬通過不代表Google端已更新。
