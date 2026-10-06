// Shared PCMC reference data (zones, departments, routing); the NLP pipeline reads the same file.
const pcmc = require('../../config/pcmc.json');

const ZONE_IDS = Object.keys(pcmc.zones);
const findDepartment = (id) => pcmc.departments.find((d) => d.id === id);
const isExternalDepartment = (id) => Boolean(findDepartment(id)?.external);

// Official PCMC names are bare ("Health", "आरोग्य"); add "Department"/"विभाग" for use in sentences and signatures.
const departmentName = (id, language = 'English') => {
  const dept = findDepartment(id);
  if (!dept) return id;
  if (language === 'Hindi') return /(कार्यालय|पुलिस|विभाग)/.test(dept.hi) ? dept.hi.replace(/\s*\(बाहरी\)/, '') : `${dept.hi} विभाग`;
  if (language === 'Marathi') return /(कार्यालय|पोलीस|विभाग)/.test(dept.mr) ? dept.mr.replace(/\s*\(बाह्य\)/, '') : `${dept.mr} विभाग`;
  const english = dept.id.replace(/\s*\(external\)/, '');
  return /(Office|Police|Department|Control)$/.test(english) ? english : `${english} Department`;
};

const corporationName = (language = 'English') => ({ Hindi: pcmc.corporation.hi, Marathi: pcmc.corporation.mr }[language] || pcmc.corporation.en);

module.exports = { pcmc, ZONE_IDS, departmentName, corporationName, isExternalDepartment };
