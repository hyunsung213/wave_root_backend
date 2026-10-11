const PASS_PRICE = 3900;

// Prices are deliberately owned by the server; never trust checkout totals from the browser.
const PRODUCTS = Object.freeze({
  basil: Object.freeze({ id: 'basil', name: '바질', price: 5000, growthTargetDays: 75 }),
  lettuce: Object.freeze({ id: 'lettuce', name: '상추', price: 3000, growthTargetDays: 45 }),
  romaine: Object.freeze({ id: 'romaine', name: '로메인', price: 4000, growthTargetDays: 68 }),
  tomato: Object.freeze({ id: 'tomato', name: '토마토', price: 6000, growthTargetDays: 80 }),
  pepper: Object.freeze({ id: 'pepper', name: '고추', price: 5000, growthTargetDays: 80 })
});

module.exports = { PASS_PRICE, PRODUCTS };