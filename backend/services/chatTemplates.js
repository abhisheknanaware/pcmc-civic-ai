// Fixed chatbot replies (no LLM needed): instant, and always correct in each language.
const HELPLINE = require('../../config/pcmc.json').corporation.sarathiHelpline;

const TOPIC_LABELS = {
  English: { garbage: 'garbage collection', roads: 'road / pothole', street_lights: 'street light', drainage: 'drainage', water: 'water supply', general: 'civic' },
  Hindi: { garbage: 'कचरा संग्रह', roads: 'सड़क / गड्ढे', street_lights: 'स्ट्रीट लाइट', drainage: 'जल निकासी', water: 'जल आपूर्ति', general: 'नागरिक' },
  Marathi: { garbage: 'कचरा संकलन', roads: 'रस्ते / खड्डे', street_lights: 'पथदिवे', drainage: 'ड्रेनेज', water: 'पाणीपुरवठा', general: 'नागरी' },
  Hinglish: { garbage: 'garbage collection', roads: 'road / pothole', street_lights: 'street light', drainage: 'drainage', water: 'paani supply', general: 'civic' },
};

const T = {
  English: {
    greeting: 'Hello! I am the PCMC civic assistant. I can answer questions about PCMC services, help you register a complaint, or check the status of one.',
    complaint: (topic) => `This sounds like a ${topic} complaint. Would you like to register it? It will be routed to the right PCMC department automatically.`,
    statusWithTicket: (ticket) => `To show the status of ${ticket}, please confirm the email address you used when filing it.`,
    statusAsk: 'Please enter your ticket number (for example PCMC-100001) and the email address you used when filing the complaint.',
    handoff: `I couldn't find verified information about that. You can check PCMC's official e-Seva services, call the Sarathi helpline at ${HELPLINE}, or register a complaint here.`,
    outOfScope: `I can only help with PCMC civic services and complaints. For anything else, please contact the relevant authority. For PCMC help, call Sarathi at ${HELPLINE}.`,
    statusIntro: (ticket) => `Here is the latest status of complaint ${ticket}:`,
    statusNotFound: 'No complaint was found for this ticket number and email.',
    error: `Sorry, I couldn't process that right now. Please try again, or call the Sarathi helpline at ${HELPLINE}.`,
  },
  Hindi: {
    greeting: 'नमस्ते! मैं PCMC नागरिक सहायक हूँ। मैं PCMC सेवाओं के बारे में जानकारी दे सकता हूँ, शिकायत दर्ज करने में मदद कर सकता हूँ, या शिकायत की स्थिति बता सकता हूँ।',
    complaint: (topic) => `यह ${topic} से जुड़ी शिकायत लगती है। क्या आप इसे दर्ज करना चाहेंगे? यह अपने आप सही PCMC विभाग को भेज दी जाएगी।`,
    statusWithTicket: (ticket) => `${ticket} की स्थिति देखने के लिए, कृपया शिकायत दर्ज करते समय दिया गया ईमेल पता बताएं।`,
    statusAsk: 'कृपया अपना टिकट नंबर (जैसे PCMC-100001) और शिकायत दर्ज करते समय दिया गया ईमेल पता दर्ज करें।',
    handoff: `मुझे इसकी सत्यापित जानकारी नहीं मिली। आप PCMC की आधिकारिक ई-सेवा देख सकते हैं, सारथी हेल्पलाइन ${HELPLINE} पर कॉल कर सकते हैं, या यहाँ शिकायत दर्ज कर सकते हैं।`,
    outOfScope: `मैं केवल PCMC नागरिक सेवाओं और शिकायतों में मदद कर सकता हूँ। PCMC सहायता के लिए सारथी ${HELPLINE} पर कॉल करें।`,
    statusIntro: (ticket) => `शिकायत ${ticket} की ताज़ा स्थिति:`,
    statusNotFound: 'इस टिकट नंबर और ईमेल के लिए कोई शिकायत नहीं मिली।',
    error: `क्षमा करें, अभी यह संभव नहीं हो सका। कृपया फिर से प्रयास करें या सारथी हेल्पलाइन ${HELPLINE} पर कॉल करें।`,
  },
  Marathi: {
    greeting: 'नमस्कार! मी PCMC नागरी सहाय्यक आहे. मी PCMC सेवांबद्दल माहिती देऊ शकतो, तक्रार नोंदवण्यास मदत करू शकतो किंवा तक्रारीची स्थिती सांगू शकतो.',
    complaint: (topic) => `ही ${topic} संबंधित तक्रार दिसते. तुम्हाला ही तक्रार नोंदवायची आहे का? ती आपोआप योग्य PCMC विभागाकडे पाठवली जाईल.`,
    statusWithTicket: (ticket) => `${ticket} ची स्थिती पाहण्यासाठी, कृपया तक्रार नोंदवताना दिलेला ईमेल पत्ता सांगा.`,
    statusAsk: 'कृपया तुमचा तिकीट क्रमांक (उदा. PCMC-100001) आणि तक्रार नोंदवताना दिलेला ईमेल पत्ता टाका.',
    handoff: `मला याबद्दल पडताळलेली माहिती मिळाली नाही. तुम्ही PCMC च्या अधिकृत ई-सेवा पाहू शकता, सारथी हेल्पलाइन ${HELPLINE} वर कॉल करू शकता किंवा येथे तक्रार नोंदवू शकता.`,
    outOfScope: `मी फक्त PCMC नागरी सेवा आणि तक्रारींसाठी मदत करू शकतो. PCMC मदतीसाठी सारथी ${HELPLINE} वर कॉल करा.`,
    statusIntro: (ticket) => `तक्रार ${ticket} ची सध्याची स्थिती:`,
    statusNotFound: 'या तिकीट क्रमांक आणि ईमेलसाठी कोणतीही तक्रार सापडली नाही.',
    error: `क्षमस्व, आत्ता हे करता आले नाही. कृपया पुन्हा प्रयत्न करा किंवा सारथी हेल्पलाइन ${HELPLINE} वर कॉल करा.`,
  },
  Hinglish: {
    greeting: 'Namaste! Main PCMC civic assistant hoon. Main PCMC services ki jaankari de sakta hoon, complaint register karne mein madad kar sakta hoon, ya complaint ka status bata sakta hoon.',
    complaint: (topic) => `Yeh ${topic} complaint lag rahi hai. Kya aap ise register karna chahenge? Yeh apne aap sahi PCMC department ko bhej di jayegi.`,
    statusWithTicket: (ticket) => `${ticket} ka status dekhne ke liye, complaint file karte waqt diya gaya email address confirm karein.`,
    statusAsk: 'Apna ticket number (jaise PCMC-100001) aur complaint file karte waqt diya gaya email address daalein.',
    handoff: `Mujhe iski verified jaankari nahi mili. Aap PCMC ki official e-Seva services dekh sakte hain, Sarathi helpline ${HELPLINE} par call kar sakte hain, ya yahan complaint register kar sakte hain.`,
    outOfScope: `Main sirf PCMC civic services aur complaints mein madad kar sakta hoon. PCMC help ke liye Sarathi ${HELPLINE} par call karein.`,
    statusIntro: (ticket) => `Complaint ${ticket} ka latest status:`,
    statusNotFound: 'Is ticket number aur email ke liye koi complaint nahi mili.',
    error: `Maaf kijiye, abhi yeh nahi ho paya. Dobara try karein ya Sarathi helpline ${HELPLINE} par call karein.`,
  },
};

const LANGUAGES = Object.keys(T);
const UI_TO_LANGUAGE = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

const templates = (language) => T[language] || T.English;
const topicLabel = (language, topic) => (TOPIC_LABELS[language] || TOPIC_LABELS.English)[topic] || (TOPIC_LABELS[language] || TOPIC_LABELS.English).general;

module.exports = { templates, topicLabel, LANGUAGES, UI_TO_LANGUAGE, HELPLINE };
