# Translations to review

These 126 keys were added to `public/lang.js` for the membership layer (sign-in, trial, paywall,
account and admin). English is always shown by the app; the chosen language sits beneath it.

- **`pt`, `ny` and `bem` are machine-assisted for all 126 keys (378 strings) and need a native speaker.**
- `zu` was written by hand, not machine-translated, but a speaker's check is still welcome.
- `{n}`, `{p}`, `{d}` and `{e}` are placeholders the app fills in (days, price, date, e-mail).
- This file is a copy for reviewers: `public/lang.js` is the source. Regenerate it after wording changes.

## Sign-in and account creation

| key | English (source) | isiZulu | Português | Chichewa | iciBemba |
|---|---|---|---|---|---|
| `net_timeout` | The server did not answer. Please try again. | Iseva ayiphendulanga. Sicela uzame futhi. | O servidor não respondeu. Tente novamente. | Seva sinayankhe. Chonde yesaninso. | Seva taisubile. Napapata eseni na kabili. |
| `net_error` | Something went wrong on our side. Please try again. | Kukhona okungahambanga kahle ngakithi. Sicela uzame futhi. | Algo correu mal do nosso lado. Tente novamente. | Chinachake chalakwa kumbali yathu. Yesaninso. | Kwaba ifyapilika ku lubali lwesu. Eseni na kabili. |
| `loading` | Loading… | Iyalayisha… | A carregar… | Kukweza… | Tuleisula… |
| `confirm` | Confirm | Qinisekisa | Confirmar | Tsimikizani | Shininkisheni |
| `cancel` | Cancel | Khansela | Cancelar | Letsani | Fumyapo |
| `auth_signin_tab` | Sign in | Ngena | Entrar | Lowani | Ingileni |
| `auth_signup_tab` | Create account | Vula i-akhawunti | Criar conta | Pangani akaunti | Pangeni akaunti |
| `auth_signin_btn` | Sign in | Ngena | Entrar | Lowani | Ingileni |
| `auth_signup_btn` | Create my account | Vula i-akhawunti yami | Criar a minha conta | Pangani akaunti yanga | Pangeni akaunti yandi |
| `auth_password` | Password | Iphasiwedi | Palavra-passe | Achinswi | Ipassword |
| `auth_password_repeat` | Repeat password | Phinda iphasiwedi | Repita a palavra-passe | Bwerezeni achinswi | Bwesheni ipassword |
| `auth_pw_needed` | Please enter your password. | Sicela ufake iphasiwedi yakho. | Introduza a sua palavra-passe. | Chonde lembani achinswi anu. | Napapata lembeni ipassword yenu. |
| `auth_pw_mismatch` | The two passwords do not match. | Amaphasiwedi amabili awafani. | As duas palavras-passe não coincidem. | Achinswi awiri sakufanana. | Amapassword yabili tayalingana. |
| `auth_pw_rule_len` | At least 8 characters | Okungenani izinhlamvu eziwu-8 | Pelo menos 8 caracteres | Zilembo zosachepera 8 | Ifilembo ifishafika 8 |
| `auth_pw_rule_mix` | At least one letter and one digit | Okungenani uhlamvu olulodwa lwegama nenombolo eyodwa | Pelo menos uma letra e um número | Kalata imodzi ndi nambala imodzi | Ilembo limo na nambala imo |
| `auth_pw_rule_max` | 72 characters maximum | Ubuningi buyizinhlamvu eziwu-72 | Máximo de 72 caracteres | Zilembo zosapitirira 72 | Ifingi ifilembo 72 |
| `auth_weak_pw` | That password is too weak. Use at least 8 characters with a letter and a digit. | Leyo phasiwedi ibuthakathaka kakhulu. Sebenzisa okungenani izinhlamvu eziwu-8 ezinohlamvu lwegama nenombolo. | Essa palavra-passe é demasiado fraca. Use pelo menos 8 caracteres com uma letra e um número. | Achinswi amenewo ndi ofooka kwambiri. Gwiritsani ntchito zilembo zosachepera 8 zokhala ndi kalata ndi nambala. | Iyo password yafooka sana. Bomfyeni ifilembo ifishafika 8 ifikwete ilembo na nambala. |
| `auth_config` | This app still needs its Supabase settings before anyone can sign in. Please tell the site owner. | Uhlelo alukagcwaliswa izilungiselelo ze-Supabase. Sicele utshele umnikazi wesayithi. | Esta aplicação ainda precisa das definições do Supabase. Por favor avise o responsável do site. | Pulogalamuyi ikufunikabe makonzedwe a Supabase. Chonde uzitsitse kwa mwini wa tsamba. | Uyu uprogramu ulacili naipanga ifyakonfika fya Supabase. Napapata shibikeni ku mwine site. |
| `auth_wrong_password` | Wrong e-mail or password. Please try again. | I-imeyili noma iphasiwedi ayilungile. Sicela uzame futhi. | Email ou palavra-passe errados. Tente novamente. | Imelo kapena achinswi salondola. Yesaninso. | Imeli nangu ipassword tailungile. Eseni na kabili. |
| `auth_email_taken` | That e-mail already has an account. Please sign in. | Leyo imeyili isivele ine-akhawunti. Sicela ungene. | Esse email já tem uma conta. Entre, por favor. | Imelo imeneyo ili kale ndi akaunti. Chonde lowani. | Iyo imeli ikwete kale akaunti. Napapata ingileni. |
| `auth_too_many` | Too many attempts. Please wait a few minutes and try again. | Kuzame kakhulu. Sicela ulinde imizuzu embalwa bese uzama futhi. | Demasiadas tentativas. Aguarde alguns minutos e tente novamente. | Mayesero ambirimbiri. Dikirani mphindi zingapo ndipo yesaninso. | Mwaesha imiku iingi. Napapata loleleni inshita ibanono no kwesha na kabili. |
| `auth_offline` | You are offline. Connect to the internet and try again. | Awuxhunyiwe ku-inthanethi. Xhuma bese uzama futhi. | Está offline. Ligue-se à internet e tente novamente. | Simuli pa intaneti. Lumikizani ku intaneti ndipo yesaninso. | Tamuli pa intaneti. Kumyeni ku intaneti no kwesha na kabili. |
| `auth_generic_fail` | That did not work. Please try again. | Akusebenzanga. Sicela uzame futhi. | Isso não funcionou. Tente novamente. | Zimenezi sizinayende. Yesaninso. | Ici tacabombwe. Eseni na kabili. |
| `auth_confirm_on` | This account still asks for e-mail confirmation, which this app does not use. Please ask an admin for help. | Le akhawunti isacela ukuqinisekiswa nge-imeyili, into le app engayisebenzisi. Sicela ucele usizo kumlawuli. | Esta conta ainda pede confirmação por email, que esta aplicação não usa. Peça ajuda a um administrador. | Akaunti iyi ikufunsabe kutsimikizira kwa imelo, komwe pulogalamuyi siigwiritsa ntchito. Pemphani thandizo kwa woyang'anira. | Iyi akaunti icilomba ukushininkishiwa kwa imeli, ico ici app tacibomfya. Napapata lombeni ubwafwilishi ku kaleba. |
| `auth_no_email_note` | Lost your password? Ask a TSHK admin to reset it — you will get a temporary password and choose a new one when you sign in. | Uyikhohliwe iphasiwedi yakho? Cela umlawuli we-TSHK ayisethe kabusha — uzothola iphasiwedi yesikhashana bese ukhetha entsha uma ungena. | Perdeu a palavra-passe? Peça a um administrador da TSHK para a repor — receberá uma palavra-passe temporária e escolherá uma nova ao entrar. | Mwataya achinswi anu? Pemphani woyang'anira wa TSHK kuti awasinthe — mudzalandira achinswi akanthawi ndikusankha atsopano mukalowa. | Mwaluba ipassword yenu? Lomba ukaleba wa TSHK ukuti ai-alule — mukasanga ipassword ya kanshita no kusala ipya ilyo mwingila. |
| `auth_needed` | Please sign in. | Sicela ungene kuqala. | Entre primeiro, por favor. | Chonde lowani choyamba. | Napapata ingileni ntanshi. |

## Forced password change and changing a password

| key | English (source) | isiZulu | Português | Chichewa | iciBemba |
|---|---|---|---|---|---|
| `forcepw_title` | Choose a new password | Khetha iphasiwedi entsha | Escolha uma nova palavra-passe | Sankhani achinswi atsopano | Saleni ipassword ipya |
| `forcepw_sub` | An admin reset your password. Choose your own before you continue. | Umlawuli usethe kabusha iphasiwedi yakho. Khetha eyakho ngaphambi kokuba uqhubeke. | Um administrador repôs a sua palavra-passe. Escolha a sua antes de continuar. | Woyang'anira wasintha achinswi anu. Sankhani anu musanapitirize. | Ukaleba waalula ipassword yenu. Saleni iya kumwina ilyo mutwalilila. |
| `forcepw_btn` | Save my new password | Londoloza iphasiwedi yami entsha | Guardar a minha nova palavra-passe | Sungani achinswi anga atsopano | Sungeni ipassword yandi ipya |
| `pw_new` | New password | Iphasiwedi entsha | Nova palavra-passe | Achinswi atsopano | Ipassword ipya |
| `pw_current` | Current password | Iphasiwedi yamanje | Palavra-passe actual | Achinswi omwe muli nawo | Ipassword ya nomba |
| `pw_change` | Change password | Shintsha iphasiwedi | Alterar palavra-passe | Sinthani achinswi | Aluleni ipassword |
| `pw_change_btn` | Change my password | Shintsha iphasiwedi yami | Alterar a minha palavra-passe | Sinthani achinswi anga | Aluleni ipassword yandi |
| `pw_changed` | Your password has been changed. | Iphasiwedi yakho ishintshiwe. | A sua palavra-passe foi alterada. | Achinswi anu asinthidwa. | Ipassword yenu yalulwa. |
| `pwerr_short` | At least 8 characters are needed. | Kudingeka okungenani izinhlamvu eziwu-8. | São necessários pelo menos 8 caracteres. | Zilembo zosachepera 8 zikufunika. | Kulekabila ifilembo ifishafika 8. |
| `pwerr_long` | 72 characters is the maximum. | Izinhlamvu eziwu-72 umkhawulo. | O máximo são 72 caracteres. | Zilembo 72 ndiye malire. | Ifingi ifilembo 72. |
| `pwerr_mix` | The password needs a letter and a digit. | Iphasiwedi idinga uhlamvu lwegama nenombolo. | A palavra-passe precisa de uma letra e um número. | Achinswi akufunika kalata ndi nambala. | Ipassword ilekabila ilembo na nambala. |
| `pwerr_same` | That is the password you already use. Please choose a different one. | Lena iphasiwedi oyisebenzisayo. Sicela ukhethe enye. | Essa é a palavra-passe que já usa. Escolha outra. | Awa ndi achinswi omwe mumagwiritsa ntchito. Sankhani ena. | Iyi e ipassword iyo mubomfya kale. Napapata saleni imbi. |
| `pwerr_current_required` | Please enter your current password. | Sicela ufake iphasiwedi yakho yamanje. | Introduza a sua palavra-passe actual. | Chonde lembani achinswi anu omwe muli nawo. | Napapata lembeni ipassword yenu ya nomba. |
| `pwerr_current_wrong` | Your current password is not right. | Iphasiwedi yakho yamanje ayilungile. | A sua palavra-passe actual não está correcta. | Achinswi anu omwe muli nawo salondola. | Ipassword yenu ya nomba tailungile. |

## Trial welcome, features and price

| key | English (source) | isiZulu | Português | Chichewa | iciBemba |
|---|---|---|---|---|---|
| `welcome_title` | Welcome — your free trial has started | Siyakwamukela — isikhathi sakho sokuzama mahhala siqalile | Bem-vindo — o seu teste grátis começou | Takulandirani — kuyesa kwanu kwaulere kwachiyamba | Twamupokelela — ukweshako kwa fye kwatendeka |
| `welcome_sub` | You have ${trialDays()} days free with the whole app. | Unezinsuku ezingu-{n} mahhala nge-app yonke. | Tem {n} dias grátis com toda a aplicação. | Muli ndi masiku {n} aulere ndi pulogalamu yonse. | Mwikwete inshiku {n} sha fye na ici app conse. |
| `welcome_price` | After the trial: ${money()} per month. Cancel any time — access continues until the paid month ends. | Emva kokuzama: {p} ngenyanga. Khansela noma nini — ukufinyelela kuyoqhubeka kuze kuphele inyanga okhokhele yona. | Depois do teste: {p} por mês. Cancele quando quiser — o acesso continua até ao fim do mês pago. | Pambuyo poyesa: {p} pa mwezi. Letsani nthawi iliyonse — mwayi umapitiriza mpaka mwezi wolipira utha. | Panuma ya kwesha: {p} pa mweshi. Fumyapo inshita ili yonse — ukubomfya kutwalilila ukufika umweshi mwalipila wapwa. |
| `welcome_trial` | Start my free trial | Qala isikhathi sami sokuzama mahhala | Começar o meu teste grátis | Yambitsani kuyesa kwanga kwaulere | Tendekeni ukweshako kwandi kwa fye |
| `f_compass` | Compass pointing to Ekuphumuleni | Ikhompasi ekhomba e-Ekuphumuleni | Bússola a apontar para Ekuphumuleni | Kampasi yolozera ku Ekuphumuleni | Kampasi iilanga ku Ekuphumuleni |
| `f_msamo` | Msamo positioning with a turn instruction | Ukubeka umsamo nesiqondiso sokuphendula | Posicionamento do msamo com instrução de rotação | Kuyika msamo ndi malangizo ozungulira | Ukubika msamo na mafunde ya kupilibuka |
| `f_sun` | Sun height, facing-the-sun and stick-shadow guidance | Ukuphakama kwelanga, ukubheka ilanga nomhlahlandlela wesithunzi senduku | Altura do sol, virar-se para o sol e orientação pela sombra de um pau | Kutalika kwa dzuwa, kuyang'ana dzuwa ndi malangizo a mthunzi wa ndodo | Ubutali bwa kasuba, ukulolesha kasuba na malangizo ya cinshikishi ca cimuti |
| `f_centres` | Centres directory with search, nearest and directions | Uhlu lwezikhungo nokusesha, eseduze nemiyalelo yendlela | Directório de centros com pesquisa, o mais perto e direcções | Mndandanda wa malo ndi kusaka, apafupi ndi njira | Ibuku lya ififulo na ukufwaya, ifili mupepi na inshila |
| `f_lang` | Five languages | Izilimi ezinhlanu | Cinco idiomas | Zinenero zisanu | Indimi shisanu |
| `f_offline` | The compass keeps working offline | Ikhompasi iyaqhubeka isebenza ungaxhunyiwe ku-inthanethi | A bússola continua a funcionar offline | Kampasi imapitiriza kugwira ntchito popanda intaneti | Kampasi icili ilebomba nangu tamukwete intaneti |
| `pay_now` | Pay now | Khokha manje | Pagar agora | Lipirani tsopano | Lipileni nomba |
| `pay_fine` | Secure payment by PayFast · cancel any time | Inkokhelo ephephile nge-PayFast · khansela noma nini | Pagamento seguro pela PayFast · cancele quando quiser | Kulipira kotetezedwa ndi PayFast · letsani nthawi iliyonse | Ukulipa ukwa cishinka na PayFast · fumyapo inshita ili yonse |
| `per_month` | / month | / ngenyanga | / mês | / pa mwezi | / pa mweshi |

## Paywall, access and offline

| key | English (source) | isiZulu | Português | Chichewa | iciBemba |
|---|---|---|---|---|---|
| `pay_check_again` | Check again | Hlola futhi | Verificar de novo | Onaninso | Lolesheni na kabili |
| `pay_active_until` | Active until ${fmtDate(ent.access_until)}, then it renews | Kuyasebenza kuze kube ngu-{d}, bese kuyavuselelwa | Activo até {d}, depois renova | Ikugwira ntchito mpaka {d}, kenano kumakonzanso | Cilebomba ukufika {d}, elyo cikalandululwa |
| `pay_grace` | Payment is late: please check your payment | Inkokhelo ibambezelekile: sicela uhlole inkokhelo yakho | O pagamento está em atraso: verifique o seu pagamento | Kulipira kwachedwa: onani zolipira zanu | Ubulipilo bwacelela: lolesheni ubulipilo bwenu |
| `pay_grace_chip` | Payment late | Inkokhelo ibambezelekile | Pagamento em atraso | Kulipira kwachedwa | Ubulipilo bwacelela |
| `pay_no_sub` | There is no active subscription to cancel. | Akukho ukubhalisa okusebenzayo okuzokhanselwa. | Não há assinatura activa para cancelar. | Palibe kulembetsa kogwira ntchito koti muchotse. | Tamwakwata ukwilembesha ukulebomba ukufumyapo. |
| `pay_already` | You already have an active subscription. | Usuvele unokubhalisa okusebenzayo. | Já tem uma assinatura activa. | Muli kale ndi kulembetsa kogwira ntchito. | Mukwete kale ukwilembesha ukulebomba. |
| `pay_needed` | A membership is needed to see the centres. | Kudingeka ubulungu ukuze ubone izikhungo. | É necessária uma assinatura para ver os centros. | Umembala ukufunika kuti muone malo. | Ubwa membala bulekabila pa kumona ififulo. |
| `offline_copy` | Offline copy | Ikhophi engaxhunyiwe ku-inthanethi | Cópia offline | Chithunzithunzi cha offline | Ikopi ya offline |
| `c_unavailable` | The centres list is not available right now. The compass and the sun guide still work. | Uhlu lwezikhungo alutholakali manje. Ikhompasi nomhlahlandlela welanga kusasebenza. | A lista de centros não está disponível agora. A bússola e o guia do sol continuam a funcionar. | Mndandanda wa malo sulikupezeka panopa. Kampasi ndi malangizo a dzuwa zikugwirabe ntchito. | Ibuku lya ififulo talipo nomba. Kampasi na malangizo ya kasuba ficili filebomba. |

## Admin: members

| key | English (source) | isiZulu | Português | Chichewa | iciBemba |
|---|---|---|---|---|---|
| `admin_btn` | Admin | Umlawuli | Administração | Woyang'anira | Umutungulushi |
| `admin_state` | Admin account — always available | I-akhawunti yomlawuli — ihlala itholakala | Conta de administrador — sempre disponível | Akaunti ya woyang'anira — nthawi zonse ikupezeka | Akaunti ya kaleba — iikalipo lyonse |
| `admin_back` | Back to the app | Buyela ku-app | Voltar à aplicação | Bwererani ku pulogalamu | Bweleleni ku app |
| `admin_tab_users` | Members | Amalungu | Membros | Mamembala | Abamembala |
| `admin_search` | Search by e-mail | Sesha nge-imeyili | Procurar por email | Sakani ndi imelo | Fwayeni na imeli |
| `admin_you` | You | Wena | Você | Inu | Imwe |
| `admin_member` | Member | Ilungu | Membro | Membala | Uwa membala |
| `admin_until` | Until | Kuze kube | Até | Mpaka | Ukufika |
| `admin_users_none` | No members found | Akukho malungu atholakele | Nenhum membro encontrado | Palibe mamembala apezeka | Tapali abamembala abasangwa |
| `admin_load_fail` | Could not load the centres. | Asikwazanga ukulayisha uhlu. | Não foi possível carregar a lista. | Sizathe kutsitsa mndandanda. | Tatukonshishe ukubomba ibuku. |
| `admin_not_allowed` | This area is for admins. | Le ndawo ngeyabalawuli. | Esta área é para administradores. | Dera lino ndi la oyanganira. | Ici cipande ca bakaleba fye. |
| `admin_err_self_reset` | You cannot reset your own password here. | Awukwazi ukusetha kabusha iphasiwedi yakho lapha. | Não pode repor a sua própria palavra-passe aqui. | Simungasinthe achinswi anu okha pano. | Tamukonsha ukwalula ipassword yenu muno. |
| `admin_err_self_delete` | You cannot delete your own account here. | Awukwazi ukususa i-akhawunti yakho lapha. | Não pode apagar a sua própria conta aqui. | Simungachotse akaunti yanu nokha pano. | Tamukonsha ukufumyapo akaunti yenu muno. |
| `admin_err_admin_target` | Admins cannot be changed here. | Abalawuli abashintshwa lapha. | Os administradores não podem ser alterados aqui. | Oyang'anira sangasintheidwe pano. | Abakaleba tabakonsha ukwalulwa muno. |
| `admin_err_not_found` | That member was not found. | Lelo lungu alitholakalanga. | Esse membro não foi encontrado. | Membala ameneyo sanapezeke. | Uyo wa membala tasasangwa. |
| `err_not_found` | That record was not found. | Lelo rekhodi alitholakalanga. | Esse registo não foi encontrado. | Zolemba zimenezi sizinapezeke. | Ico tacasangwa. |
| `admin_reset_pw` | Auto-generate password | Zenzele iphasiwedi ngokwayo | Gerar palavra-passe automaticamente | Pangani achinswi zokha | Pangeni ipassword yomwini |
| `admin_reset_confirm` | Create a new temporary password for ${u.email}? | Kwenziwe iphasiwedi yesikhashana entsha ka-{e}? | Criar uma nova palavra-passe temporária para {e}? | Pangani achinswi akanthawi atsopano a {e}? | Tupange ipassword ipya ya kanshita iya {e}? |
| `admin_generate` | Generate | Yenza | Gerar | Pangani | Pangeni |
| `admin_reset_title` | Temporary password for ${d.email \|\| u.email} | Iphasiwedi yesikhashana ka-{e} | Palavra-passe temporária para {e} | Achinswi akanthawi a {e} | Ipassword ya kanshita iya {e} |
| `admin_reset_note` | Give this to the member. They must change it when they sign in. | Nikeza leli lungu. Kumele alishintshe uma engena. | Entregue isto ao membro. Ele tem de a alterar ao entrar. | Patsani mamembala amenewa. Ayenera kuwasintha akalowa. | Peleni uyu wa membala. Alekabila ukwalula ilyo aingila. |
| `admin_copy` | Copy | Kopisha | Copiar | Koperani | Kopeni |
| `admin_copied` | Copied | Kukopishiwe | Copiado | Zakopedwa | Cakopwa |
| `admin_delete` | Delete user | Susa umsebenzisi | Apagar utilizador | Chotsani wogwiritsa ntchito | Fumyapo uubomfya |
| `admin_delete_confirm` | Delete ${c.name}? This cannot be undone. | Suse u-{e}? Lokhu akubuyiseki. | Apagar {e}? Isto não pode ser desfeito. | Chotsani {e}? Izi sizingabwezeretsedwe. | Tufumyepo {e}? Ici tacikonsha ukubweshiwa. |
| `admin_delete_warn` | If they have an active subscription it is cancelled first. | Uma benokubhalisa okusebenzayo, kuyakhanselwa kuqala. | Se tiverem uma assinatura activa, é cancelada primeiro. | Ngati ali ndi kulembetsa kogwira ntchito, chotsedwa choyamba. | Nga bakwete ukwilembesha ukulebomba, kutwalwa ukufumishiwa ntanshi. |
| `admin_delete_type` | Type the e-mail to confirm | Bhala i-imeyili ukuqinisekisa | Escreva o email para confirmar | Lembani imelo kuti mutsimikizire | Lembeni imeli pa kushininkisha |
| `admin_delete_btn` | Delete | Susa | Apagar | Chotsani | Fumyapo |
| `admin_delete_force_title` | PayFast could not cancel the subscription | I-PayFast ayikwazanga ukukhansela ukubhalisa | A PayFast não conseguiu cancelar a assinatura | PayFast sinathe kuletsa kulembetsa | PayFast taikonshishe ukufumyapo ukwilembesha |
| `admin_delete_force_note` | PayFast did not cancel the subscription of ${u.email}. Delete anyway? They could still be charged. | I-PayFast ayikhanselanga ukubhalisa kuka-{e}. Susa noma kunjalo? Bangase bakhokhiswe. | A PayFast não cancelou a assinatura de {e}. Apagar mesmo assim? Ainda podem ser cobrados. | PayFast sinaletsa kulembetsa kwa {e}. Chotsanibe? Atha kulipitsidwabe. | PayFast taifumyepo ukwilembesha kwa {e}. Tufumyepo nangu fyenka? Balakonsha ukulipishiwa. |
| `admin_delete_force` | Delete anyway | Susa noma kunjalo | Apagar mesmo assim | Chotsanibe | Fumyepo nangu fyenka |
| `admin_deleted` | ${d.email \|\| u.email} was deleted. | U-{e} usususiwe. | {e} foi apagado. | {e} wachotsedwa. | {e} bafumishiwapo. |
| `flag_admin` | admin | umlawuli | administrador | woyang'anira | kaleba |
| `flag_pw` | must change password | kumele ashintshe iphasiwedi | tem de alterar a palavra-passe | ayenera kusintha achinswi | alekabila ukwalula ipassword |
| `flag_sub` | subscription | ukubhalisa | assinatura | kulembetsa | ukwilembesha |
| `flag_trial` | Free trial | Isikhathi sokuzama mahhala | Teste grátis | Kuyesa kwaulere | Ukwesha kwa fye |
| `flag_active` | Active | Kuyasebenza | Activa | Ikugwira ntchito | Cilebomba |
| `flag_cancelled` | Cancelled | Kukhanseliwe | Cancelada | Zaletsedwa | Cafumishiwapo |
| `flag_pastdue` | Payment not received | Inkokhelo ayitholakalanga | Pagamento não recebido | Kulipira sikunalandiridwe | Ubulipilo tapwapokelelwe |
| `flag_trial_ended` | Trial ended | Isikhathi sokuzama siphelile | Teste terminado | Kuyesa kwatha | Ukwesha kwapwa |
| `flag_unverified` | not verified | akuqinisekisiwe | não verificado | sinatsimikizidwe | taca shingishiwa |

## Admin: centres and validation

| key | English (source) | isiZulu | Português | Chichewa | iciBemba |
|---|---|---|---|---|---|
| `c_name` | Name | Igama | Nome | Dzina | Ishina |
| `c_region` | Region | Isifunda | Região | Dera | Icitungu |
| `c_address` | Address | Ikheli | Morada | Adiresi | Adilesi |
| `c_town` | Town | Idolobha | Cidade | Mzinda | Umusumba |
| `c_phone` | Phone | Ucingo | Telefone | Foni | Ifoni |
| `c_lat` | Latitude | I-latitude | Latitude | Latitudo | Latitudo |
| `c_lng` | Longitude | I-longitude | Longitude | Longitudo | Longitudo |
| `c_verified` | Verified | Kuqinisekisiwe | Verificado | Zatsimikizidwa | Cashingishiwa |
| `admin_add_centre` | Add centre | Engeza isikhungo | Adicionar centro | Onjezani malo | Lundako icifulo |
| `admin_edit_centre` | Edit centre | Lungisa isikhungo | Editar centro | Konzani malo | Lungikeni icifulo |
| `admin_save_centre` | Save centre | Londoloza isikhungo | Guardar centro | Sungani malo | Sungeni icifulo |
| `admin_edit` | Edit | Lungisa | Editar | Konzani | Lungikeni |
| `admin_delete_centre` | Delete centre | Susa isikhungo | Apagar centro | Chotsani malo | Fumyepo icifulo |
| `admin_centre_deleted` | Centre deleted | Isikhungo sisusiwe | Centro apagado | Malo achotsedwa | Icifulo cafumishiwapo |
| `admin_centre_updated` | Centre saved | Isikhungo silondoloziwe | Centro guardado | Malo asungidwa | Icifulo casungwa |
| `admin_centres_none` | No centres yet | Akukho zikhungo okwamanje | Ainda não há centros | Palibe malo panopa | Tapali ififulo |
| `admin_filter_region` | All regions | Zonke izifunda | Todas as regiões | Madera onse | Ifitungu fyonse |
| `val_name_required` | A name is needed. | Kudingeka igama. | É necessário um nome. | Dzina likufunika. | Ishina lilekabila. |
| `val_region_required` | A region is needed. | Kudingeka isifunda. | É necessária uma região. | Dera likufunika. | Icitungu cilekabila. |
| `val_coords_invalid` | Enter both latitude and longitude, or leave both empty. | Faka kokubili i-latitude ne-longitude, noma ushiye kokubili kungenalutho. | Introduza latitude e longitude, ou deixe ambas vazias. | Lembani latitudo ndi longitudo zonse, kapena siyani zonse zilibe kanthu. | Lembeni latitudo na longitudo shonse, nangu shileni shonse tapali. |
| `val_coords_range` | Latitude must be within ±90 and longitude within ±180. | I-latitude kumele ibe phakathi kuka-±90, i-longitude phakathi kuka-±180. | A latitude tem de estar entre ±90 e a longitude entre ±180. | Latitudo iyenera kukhala mkati mwa ±90 ndi longitudo mkati mwa ±180. | Latitudo ilefwaya ukuba mukati ka ±90 na longitudo mukati ka ±180. |
| `val_phone` | A phone number may use digits, spaces and + ( ) - only. | Inombolo yocingo ingaba nezinombolo, izikhala no-+ ( ) - kuphela. | Um número de telefone só pode ter dígitos, espaços e + ( ) -. | Nambala ya foni ikhoza kukhala ndi manambala, mipata ndi + ( ) - kokha. | Nambala ya foni ikonsha ukuba na manambala, impansa na + ( ) - fye. |
| `val_centre_exists` | A centre with that name and region already exists. | Kukhona isikhungo esinalelo gama naleso sifunda. | Já existe um centro com esse nome e região. | Kali kale malo okhala ndi dzina ndi dera limenelo. | Kuli kale icifulo ica ishina na citungu cimo. |

