const Product = require('../models/product')
const dotenv = require('dotenv/config')
const connectDatabase = require('../config/database')
const products = require('../data/products')

// Setting dotenv file.
dotenv.config({
  path: 'server/.env',
})

connectDatabase()

const seedProducts = async () => {
  try {
    await Product.deleteMany()
    console.log(`Products are deleted`)

    await Product.insertMany(products)
    console.log('Products are inserted')

    process.exit()
  } catch (error) {
    console.log(error.message)
    process.exit()
  }
}

seedProducts()
