// 老師的 Google Apps Script 網頁應用程式網址（部署後貼上，結尾通常是 /exec）
// 空字串 = 尚未設定，「送出給老師」按鈕會顯示「尚未設定老師的試算表」
const TEACHER_SCRIPT_URL = '';

// 雷射筆參考波長（nm）。筆上沒寫，已確定用這兩個；若之後有標籤再改這裡。
const LASER_REF = { red: 650, green: 532 };
const LASER_LABEL = { red: '紅光', green: '綠光' };

// 學生自算波長與正確值相差在此百分比以內視為相符（四捨五入誤差）
const LAMBDA_MATCH_TOL_PCT = 2;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TEACHER_SCRIPT_URL: TEACHER_SCRIPT_URL,
    LASER_REF: LASER_REF,
    LASER_LABEL: LASER_LABEL,
    LAMBDA_MATCH_TOL_PCT: LAMBDA_MATCH_TOL_PCT
  };
}
