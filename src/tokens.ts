// @ts-nocheck
import express from "express";
import * as admin from "firebase-admin";

import dotenv from "dotenv"
const tokenClient = process.env.TOKEN_CLIENT;
const DaoAbi = process.env.DAO_ABI;

const { v4: uuidv4 } = require('uuid');
import { Web3Storage, getFilesFromPath } from 'web3.storage'

import DAOFactoryAbi from "../src/DAOFactory.json";
import GoodsFactoryAbi from "../src/GoodsFactory.json";
import GoodsAbi from "../src/Goods.json";

const StreamZip = require('node-stream-zip');
const request = require('request');
const fs = require('fs');
const images = require("images");
const client = new Web3Storage({ tokenClient })

const Web3 = require('web3');

const asana = require('asana');

dotenv.config()

const web3 = new Web3(new Web3.providers.HttpProvider(`https://eth-goerli.g.alchemy.com/v2/yZIdvCyYdidI1nxEKQeR4mCPmkqP2gS5`));

const daoFactory = new web3.eth.Contract(
  DAOFactoryAbi, {DaoAbi}
);

// function to encode file data to base64 encoded string
function base64_encode(file) {
  // read binary data
  var bitmap = fs.readFileSync(file);
  // convert binary data to base64 encoded string
  return new Buffer(bitmap).toString('base64');
}

async function getMetadataFromHash(hash, tokenId) {

  console.log(hash)
  let daos = await daoFactory.methods.getFactoryArray().call();

  for (const dao of daos) {
    let GoodsFactory = new web3.eth.Contract(
      GoodsFactoryAbi,
      dao
    );

    let colls = await GoodsFactory.methods.getGoodsArray().call();
    for (const coll of colls) {
      let goods = new web3.eth.Contract(
        GoodsAbi,
        coll
      );
      let uri = await goods.methods.baseURI().call();
      console.log(uri)
      let tempHash = uri.slice(-60, -1);
      console.log(tempHash);

      if (tempHash === hash) {
        console.log("found !")
        let name = await goods.methods.name().call();
        let totalMinted = await goods.methods.totalSupply().call();

        let description = await goods.methods.description().call();
        console.log(coll)
        console.log(name)
        console.log(description)
        console.log(totalMinted)
        console.log(tokenId)
        if (tokenId < totalMinted) {
          console.log({ name: name, description: description })
          return ({ name: name, description: description });
        } else {
          return (false);
        }
      }

    }
  }
}


admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(
      //@ts-ignore
      Buffer.from(process.env.FIREBASE_CONFIG_BASE64, "base64").toString(
        "ascii"
      )
    )
  ),
  databaseURL: "https://adventure-ea7cd.firebaseio.com",
});

const db = admin.firestore();
const tokens = express.Router();

tokens.get("/token/:hash&:tokenId", async (req, res) => {
  const { tokenId } = req.params;
  const { hash } = req.params;
  console.log(tokenId)
  console.log(hash)

  console.log("processing hash: " + hash)

  const zipName = uuidv4() + ".zip";
  const imageName = uuidv4() + ".png";

  //check zip exist in ipfs
  const metadata = await (
    await db.collection("zips").doc(hash).get()
  ).data();

  console.log(metadata)
  if (metadata) {

    const tokenMetadata = await (
      await db.collection("zips").doc(hash).collection("tokens").doc(tokenId).get()
    ).data();

    if (tokenMetadata) {
      console.log("already signed ! here is the data")
      console.log(tokenMetadata)
      res.status(200).send(tokenMetadata);
    } else {

      //if not exist upload to ipfs and record to firebase
      let fileUrl = `https://${metadata.hash}.ipfs.w3s.link`;
      console.log(fileUrl)

      let output = zipName;
      request({ url: fileUrl, encoding: null }, function (err, resp, body) {
        if (err) throw err;
        fs.writeFile(output, body, function (err) {
          console.log("file written!");
          const zip = new StreamZip({ file: zipName });

          let files = [];
          zip.on('ready', async () => {
            let curDir;
            let layers = -1;

            for (const entry of Object.values(zip.entries())) {
              console.log(entry.name);
              if (((entry.name.match(/\//g) || []).length > 2) || (!entry.isDirectory && !(entry.name.endsWith('png') || entry.name.endsWith('jpg')))) {
                if (!entry.name.startsWith("__MACOSX")) {
                  fs.unlink("./" + zipName, (err => {
                    if (err) console.log(err);
                  }));

                  zip.close();
                  res.sendStatus(400);
                  return;
                }
              }

              if (!(entry.name.startsWith("__MACOSX"))) {
                if (!entry.isDirectory) {
                  let e = (entry.name).split('/')

                  if (files[(e.slice(0, -1)).join('/')]) {
                    files[(e.slice(0, -1)).join('/')].push(entry.name)
                  } else {
                    files[(e.slice(0, -1)).join('/')] = [entry.name]
                  }
                }
              }
            }

            console.log(files)

            let comp = [];
            let sortedKeys = (Object.keys(files)).sort()

            for (const layer of sortedKeys) {
              console.log("layer count ")
              console.log(Object.values(files).length)
              console.log("current layer ")
              console.log(layer)
              let rand = Math.floor(Math.random() * files[layer].length);
              console.log("roll ")
              console.log(rand)
              comp.push(zip.entryDataSync(files[layer][rand]))
            }
            console.log("comp")
            console.log(comp)


            let composition = images(comp[0]);
            for (let i = 1; i < comp.length; i++) {
              composition = composition.draw(images(comp[i]), 0, 0)

            }
            composition.save("./composed/" + imageName, {
              quality: 50
            });

            console.log(`saved ${imageName}`)

            console.log("get files from path")
            let output = await getFilesFromPath("./composed");
            const cid = await client.put(output)
            console.log('stored files with cid:', cid)

            let m = await getMetadataFromHash(hash, tokenId);
            console.log("m: ")
            console.log(m)

            let data = {
              "name": "Not signed",
              "description": "unsigned token",
              "image": `https://i.pinimg.com/originals/0a/92/fa/0a92faa8f79d9c3dc3b22af2170f8d04.gif`,
            }

            if (m) {
              data = {
                "name": m && m.name,
                "description": m && m.description,
                "image": `https://${cid}.ipfs.w3s.link/composed/${imageName}`,
              }

              if (tokenId > -1)
                await db.collection("zips").doc(hash).collection("tokens").doc(tokenId).set(data)
            }


            zip.close();
            res.status(200).send(data);
          });
        });
      });
    }
  }
});

tokens.get("/tokenPreview/:hash", async (req, res) => {
  const { hash } = req.params;

  console.log(hash)

  console.log("processing hash: " + hash)

  const zipName = uuidv4() + ".zip";
  const imageName = uuidv4() + ".png";

  //check zip exist in ipfs
  const metadata = await (
    await db.collection("zips").doc(hash).get()
  ).data();

  console.log(metadata)
  if (metadata) {
    //if not exist upload to ipfs and record to firebase
    let fileUrl = `https://${metadata.hash}.ipfs.w3s.link`;
    console.log(fileUrl)

    let output = zipName;
    request({ url: fileUrl, encoding: null }, function (err, resp, body) {
      if (err) throw err;
      fs.writeFile(output, body, function (err) {
        console.log("file written!");
        const zip = new StreamZip({ file: zipName });

        let files = [];
        zip.on('ready', async () => {
          let curDir;
          let layers = -1;

          for (const entry of Object.values(zip.entries())) {
            console.log(entry.name);
            if (((entry.name.match(/\//g) || []).length > 2) || (!entry.isDirectory && !(entry.name.endsWith('png') || entry.name.endsWith('jpg')))) {
              if (!entry.name.startsWith("__MACOSX")) {
                fs.unlink("./" + zipName, (err => {
                  if (err) console.log(err);
                }));

                zip.close();
                res.sendStatus(400);
                return;
              }
            }

            if (!(entry.name.startsWith("__MACOSX"))) {
              if (!entry.isDirectory) {
                let e = (entry.name).split('/')

                if (files[(e.slice(0, -1)).join('/')]) {
                  files[(e.slice(0, -1)).join('/')].push(entry.name)
                } else {
                  files[(e.slice(0, -1)).join('/')] = [entry.name]
                }
              }
            }
          }

          console.log(files)

          let comp = [];
          let sortedKeys = (Object.keys(files)).sort()

          for (const layer of sortedKeys) {
            console.log("layer count ")
            console.log(Object.values(files).length)
            console.log("current layer ")
            console.log(layer)
            let rand = Math.floor(Math.random() * files[layer].length);
            console.log("roll ")
            console.log(rand)
            comp.push(zip.entryDataSync(files[layer][rand]))
          }
          console.log("comp")
          console.log(comp)


          let composition = images(comp[0]);
          for (let i = 1; i < comp.length; i++) {
            composition = composition.draw(images(comp[i]), 0, 0)

          }

          composition.save("./preview/" + imageName, {
            quality: 50
          });


          const data = {
            "name": "preview",
            "image": "data:image/jpeg;base64, " + base64_encode("./preview/" + imageName),
          }

          fs.unlink("./" + zipName, (err => {
            if (err) console.log(err);
          }));

          fs.unlink("./preview/" + imageName, (err => {
            if (err) console.log(err);
          }));

          zip.close();
          res.status(200).send(data);
        });
      });
    });
  }
});

tokens.post("/zip", async (req, res) => {
  const { name } = req.body;
  const { hash } = req.body;
  console.log(hash)
  console.log(name)

  if (hash && name) {
    db.collection("zips")
      .doc(hash)
      .set({ hash: hash, name: name })
      .then(() => res.sendStatus(200));
  }

});

tokens.get("/zips", async (req, res) => {
  const snapshot = await db
    .collection("zips")
    .get();

  let zips = snapshot.docs.map((doc) => doc.data());
  console.log(zips);


  res.status(200).send(zips);
});

tokens.post("/feedback", async (req, res) => {
  const { feedback } = req.body;
  console.log(feedback)
  console.log(feedback.title)
  console.log(feedback.description)

  const client = asana.Client.create().useAccessToken(process.env.ASANA);
  client.users.me()
    .then(user => {
      client.tasks.createTask({ parent: "1202836200666202", name: feedback.title, notes: feedback.description, pretty: true, has_notifications_enabled: true, assignee: "1202836108000967" })
        .then((result) => {
          console.log(result);
        }).catch((err) => {
          console.log(err);
          console.log(err.value.errors);
          res.sendStatus(400);
        })
    })


  res.sendStatus(200);
});


export default tokens;
