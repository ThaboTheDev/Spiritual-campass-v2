/* Dashboard: load the member's centre list.
   The sign-in the app saved in this browser is used to call /api/centres; the page then
   hands the two globals to dashboard.js. Kept out of the HTML so the site CSP needs no
   'unsafe-inline' for scripts. */
/* Members only: the centre list comes from /api/centres using the sign-in saved by the app in this browser.
   Open the app once on this screen's browser and sign in; the dashboard then works until the session expires. */
var REGIONS=[],CENTRES=[];
(async function loadCentres(){
  const msg=t=>{document.getElementById("stage").innerHTML=`<p style="font:500 clamp(16px,2vw,40px) system-ui;color:#b7c1d8;max-width:70ch;text-align:center;padding:4vw">${t}</p>`;};
  let s=null;try{s=JSON.parse(localStorage.getItem("tshk-session")||"null");}catch(e){}
  if(!s){msg('Sign in to TSHK Compass in this browser first (open <a style="color:#e2b64a" href="/">the app</a>), then reload this page.');return;}
  try{
    let r=await fetch("/api/centres",{headers:{Authorization:"Bearer "+s.access_token}});
    if(r.status===401){msg('Your sign-in has expired. Open <a style="color:#e2b64a" href="/">the app</a> once to refresh it, then reload this page.');return;}
    if(r.status===402){msg("A TSHK Compass membership is needed to show the centres dashboard.");return;}
    if(r.status===403){msg('Your password has to be changed first. Open <a style="color:#e2b64a" href="/">the app</a>, choose a new password, then reload this page.');return;}
    const data=await r.json();REGIONS=data.regions;CENTRES=data.centres;window.__startDashboard();
  }catch(e){msg("Could not load the centres. Check the internet connection and reload.");}
})();
