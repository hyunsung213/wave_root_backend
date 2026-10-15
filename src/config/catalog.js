const PASS_PRICE = 3900;

// Prices are deliberately owned by the server; never trust checkout totals from the browser.
const PRODUCTS = Object.freeze({
  basil: Object.freeze({ id: 'basil', name: '바질', price: 5000, growthTargetDays: 60 }),
  lettuce: Object.freeze({ id: 'lettuce', name: '상추', price: 3000, growthTargetDays: 45 }),
  romaine: Object.freeze({ id: 'romaine', name: '로메인', price: 4000, growthTargetDays: 68 }),
  tomato: Object.freeze({ id: 'tomato', name: '토마토', price: 6000, growthTargetDays: 80 }),
  pepper: Object.freeze({ id: 'pepper', name: '고추', price: 5000, growthTargetDays: 80 }),
  arugula: Object.freeze({ id: 'arugula', name: '루꼴라', price: 4000, growthTargetDays: 45 }),
  green_oakleaf_lettuce: Object.freeze({ id: 'green_oakleaf_lettuce', name: '청오크 상추', price: 4000, growthTargetDays: 55 }),
  marigold: Object.freeze({ id: 'marigold', name: '메리골드', price: 6000, growthTargetDays: 70 }),
  butterhead: Object.freeze({ id: 'butterhead', name: '버터헤드', price: 4000, growthTargetDays: 55 }),
  nasturtium: Object.freeze({ id: 'nasturtium', name: '한련화', price: 6000, growthTargetDays: 75 }),
  tatsoi: Object.freeze({ id: 'tatsoi', name: '다채', price: 4000, growthTargetDays: 55 })
});

module.exports = { PASS_PRICE, PRODUCTS };