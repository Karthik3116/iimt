const mongoose = require("mongoose");


console.log("connecting ...")
mongoose.connect(
  "mongodb+srv://karthik3116k:v7lheKf4YxjvStXt@cluster0.edbxe4c.mongodb.net/iimt?retryWrites=true&w=majority&appName=Cluster0"
)
.then(() => {
  console.log("Connected");
})
.catch(err => {
  console.log(err.message);
});