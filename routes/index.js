const express = require("express");

const router = express.Router();
router.get("/",function(req,res){
    res.render("index");
})

router.get("/chat",function(req,res){
    const roomId = req.query.room || null;
    res.render("chat", { roomId });
})

module.exports=router;