import "reflect-metadata";
import {createConnection} from "typeorm";
import {Account} from "./powergrid-db/entity/account";

createConnection().then(async connection => {

    console.log("Inserting a new account into the database...");
    const account = new Account();
    account.address = '0x0000000000000000000000000000000000000000';
    account.balance = BigInt(100000000000000000000)
    account.energy = BigInt(100000000000000000000)
    account.code = "0x";
    account.blockTime = 0;
    account.firstSeen = 0;
    await connection.manager.save(account);
    console.log("Saved a new account with id: " + account);

    console.log("Loading users from the database...");
    const accounts = await connection.manager.find(Account);
    console.log("Loaded accounts: ", accounts);

    console.log("Here you can setup and run express/koa/any other framework.");

}).catch(error => console.log(error));
