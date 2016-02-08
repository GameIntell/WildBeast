// DougBot 2.0 beta
// Define variables first
var Discord = require("discord.js");
var bot = new Discord.Client();
var pmx = require("pmx");
var probe = pmx.probe();
var usercount, channelcount, servercount, comcount, mescount; // PMX vars
var ConfigFile = require("./config.json");
var Logger = require("./runtime/logger.js").Logger;
var Debug = require("./runtime/debugging.js");
var ChatLogger = require("./runtime/logger.js").ChatLog;
var Commands = require("./runtime/commands.js").Commands;
var Permissions = require("./runtime/permissions.js");
var VersionChecker = require("./runtime/versionchecker.js");
var aliases;
var keymetrics;
var Defaulting = require("./runtime/serverdefaulting.js");
var TimeOut = require("./runtime/timingout.js");
var Ignore = require("./runtime/ignoring.js");

// Start debug mode, if needed
Debug.prepareDebug();

// Declare aliasses
try {
  aliases = require("./runtime/alias.json");
} catch (e) {
  //No aliases defined
  aliases = {};
}

// Declare if Keymetrics analytics is needed
if (ConfigFile.bot_settings.keymetrics === true) {
  keymetrics = true;
} else {
  keymetrics = false;
}

// Error logger
bot.on("error", function(error) {
  Logger.error("Encounterd an error, please report this to the author of this bot, include any log files present in the logs folder.");
  Debug.debuglogSomething("Discord.js", "Encountered an error with discord.js most likely, got error: " + error, "error");
});

// Ready announcment
bot.on("ready", function() {
  Debug.debuglogSomething("Discord", "Ready event fired.", "info");
  if (bot.servers.length === 0) {
    Logger.warn("No servers deteted, creating default server.");
    Defaulting.create(bot);
  }
  Logger.info("Joining pre-defined servers...");
  for (var index in ConfigFile.join_on_launch) {
    bot.joinServer(ConfigFile.join_on_launch[index], function(error, server) {
      if (error) {
        Logger.warn("Couldn't join a server (" + error + ")");
      }
      if (server) {
        Logger.info("Joined " + server.name);
      }
    });
  }
  Logger.info("Ready to start!");
  Logger.info("Logged in as " + bot.user.username + ".");
  Logger.info("Serving " + bot.users.length + " users, in " + bot.servers.length + " servers.");
  if (keymetrics === false) return;
  else {
    usercount = probe.metric({
      name: 'Users',
      value: function() {
        return bot.users.length;
      }
    });
    servercount = probe.metric({
      name: 'Servers',
      value: function() {
        return bot.servers.length;
      }
    });
    channelcount = probe.metric({
      name: 'Channels',
      value: function() {
        return bot.channels.length;
      }
    });
    comcount = probe.counter({
      name: 'Commands executed'
    });
    mescount = probe.counter({
      name: 'Messages recieved'
    });
  }
});

// Disconnected announcment
bot.on("disconnected", function() {
  Debug.debuglogSomething("Discord", "Disconnected from Discord.", "warn");
  Logger.warn("Disconnected, if this wasn't a connection issue or on purpose, report this issue to the author of the bot.");
  process.exit(0); // Disconnected announcments are not always an error, seeing that disconnections can be triggered by the user.
});

// Command checker
bot.on("message", function(msg) {
  if (keymetrics === true) mescount.inc();
  if (ConfigFile.bot_settings.log_chat === true && msg.channel.server) {
    var d = new Date();
    var n = d.toUTCString();
    ChatLogger.info(n + ": " + msg.channel.server.name + ", " + msg.channel.name + ": " + msg.author.username + " said <" + msg.cleanContent + ">");
  }
  if (msg.author.equals(bot.user)) {
    return;
  }
  if (msg.channel.isPrivate && msg.content.indexOf("https://discord.gg") === 0) {
    bot.joinServer(msg.content, function(err, server) {
      if (err) {
        Debug.debuglogSomething("DougBot", "Failed to join a server on DM request.", "warn");
        bot.sendMessage(msg.author, "Something went wrong with that invite.");
      } else if (server) {
        Debug.debuglogSomething("DougBot", "Joined a server on DM request.", "info");
        var msgArray = [];
        msgArray.push("Yo! I'm **" + bot.user.username + "**, " + msg.author + " invited me to this server.");
        msgArray.push("If I'm intended to be in this server, you may use **" + ConfigFile.bot_settings.cmd_prefix + "help** to see what I can do!");
        msgArray.push("If you don't want me here, you may use **" + ConfigFile.bot_settings.cmd_prefix + "leave** to ask me to leave.");
        msgArray.push("By the way, to give " + server.owner + " administrative permissions over me, use **" + ConfigFile.bot_settings.cmd_prefix + "setowner**");
        bot.sendMessage(server.defaultChannel, msgArray);
        msgArray = [];
        msgArray.push("Hey " + server.owner.username + ", I've joined a server in which you're the founder.");
        msgArray.push("I'm " + bot.user.username + " by the way, a Discord bot, meaning that all of the things I do are mostly automated.");
        msgArray.push("If you are not keen on having me in your server, you may use `" + ConfigFile.bot_settings.cmd_prefix + "leave` in the server I'm not welcome in.");
        msgArray.push("If you do want me, use `" + ConfigFile.bot_settings.cmd_prefix + "help` to see what I can do.");
        bot.sendMessage(server.owner, msgArray);
        bot.sendMessage(msg.channel, "I've successfully joined **" + server.name + "**");
      }
    });
  }
  var prefix;
  if (ConfigFile.bot_settings.cmd_prefix != "mention") {
    prefix = ConfigFile.bot_settings.cmd_prefix;
  } else if (ConfigFile.bot_settings.cmd_prefix === "mention") {
    prefix = bot.user + " ";
  } else {
    Debug.debuglogSomething("DougBot", "Weird prefix detected.", "warn");
  }
  if (msg.content.indexOf(prefix) === 0) {
    if (keymetrics === true) comcount.inc();
    Logger.info("Executing <" + msg.cleanContent + "> from " + msg.author.username);
    var step = msg.content.substr(prefix.length);
    var chunks = step.split(" ");
    var command = chunks[0];
    alias = aliases[command];
    var suffix = msg.content.substring(command.length + (prefix.length + 1));
    if (alias) {
      command = alias[0];
      suffix = alias[1] + " " + suffix;
    }
    if (command === "help") {
      Commands.help.fn(bot, msg, suffix);
      return;
    }
    if (Commands[command]) {
      Debug.debuglogSomething("DougBot", "Command detected, trying to execute.", "info");
      if (msg.channel.server) {
        Permissions.GetLevel((msg.channel.server.id + msg.author.id), msg.author.id, function(err, level) {
          if (err) {
            Debug.debuglogSomething("LevelDB", "GetLevel failed, got error: " + err, "error");
            Logger.debug("An error occured!");
            return;
          }
          if (level >= Commands[command].level) {
            Debug.debuglogSomething("DougBot", "Execution of command allowed.", "info");
            if (Commands[command].timeout) {
              TimeOut.timeoutCheck(command, msg.channel.server.id, function(reply) {
                if (reply === "yes") {
                  Debug.debuglogSomething("DougBot", "Command is on cooldown, execution halted.", "info");
                  bot.sendMessage(msg.channel, "Sorry, this command is on cooldown.");
                  return;
                }
              });
            }
            if (!Commands[command].nsfw) {
              Debug.debuglogSomething("DougBot", "Safe for work command executed.", "info");
              Commands[command].fn(bot, msg, suffix);
              if (Commands[command].timeout) {
                TimeOut.timeoutSet(command, msg.channel.server.id, Commands[command].timeout, function(reply, err) {
                  if (err) {
                    Logger.error("Resetting timeout failed!");
                  }
                });
              }
              return;
            } else {
              Permissions.GetNSFW(msg.channel, function(err, reply) {
                Debug.debuglogSomething("DougBot", "Command is NSFW, checking if channel allows that.", "info");
                if (err) {
                  Logger.debug("Got an error! <" + err + ">");
                  Debug.debuglogSomething("LevelDB", "NSFW channel check failed, got error: " + err, "error");
                  bot.sendMessage(msg.channel, "Sorry, an error occured, try again later.");
                  return;
                }
                if (reply === "on") {
                  Debug.debuglogSomething("DougBot", "NSFW command successfully executed.", "info");
                  Commands[command].fn(bot, msg, suffix);
                  return;
                } else {
                  Debug.debuglogSomething("DougBot", "NSFW command execution failed because of channel settings.", "info");
                  bot.sendMessage(msg.channel, "You cannot use NSFW commands in this channel!");
                }
              });
            }
          } else {
            Debug.debuglogSomething("DougBot", "User has no permission to use that command.", "info");
            bot.sendMessage(msg.channel, "You don't have permission to use this command!");
            return;
          }
        });
      } else {
        Permissions.GetLevel(0, msg.author.id, function(err, level) { // Value of 0 is acting as a placeholder, because in DM's only global permissions apply.
          Debug.debuglogSomething("DougBot", "DM command detected, getting global perms.", "info");
          if (err) {
            Logger.debug("An error occured!");
            Debug.debuglogSomething("LevelDB", "GetLevel failed, got error: " + err, "error");
            return;
          }
          if (level >= Commands[command].level) {
            Debug.debuglogSomething("DougBot", "User has sufficient global perms.", "info");
            Commands[command].fn(bot, msg, suffix);
            return;
          } else {
            Debug.debuglogSomething("DougBot", "User does not have enough global permissions.", "info");
            bot.sendMessage(msg.channel, "Only global permissions apply in DM's, your server specific permissions do nothing here!");
          }
        });
      }
    }
  }
});

// Initial functions
function init(token) {
  Debug.debuglogSomething("Discord", "Sucessfully logged into Discord, returned token: " + token, "info");
  Debug.debuglogSomething("DougBot", "Continuing start-up sequence.", "info");
  Logger.info("Loading WildBeast...");
  Logger.info("Checking for updates...");
  VersionChecker.getStatus(function(err, status) {
    if (err) {
      Logger.error(err);
      if (DebugMode === true) {
        Debug.debuglogSomething("VersionChecker", "Version checking failed, got error: " + err, "error");
      }
    } // error handle
    if (status && status !== "failed") {
      Logger.info(status);
    }
  });
}

// New user welcomer
bot.on("serverNewMember", function(server, user) {
  if (ConfigFile.bot_settings.welcome_new_members === false) return;
  bot.sendMessage(server.defaultChannel, "Welcome " + user.username + " to " + server.name + "!");
});

function err(error) {
  Debug.debuglogSomething("Discord", "Logging into Discord probably failed, got error: " + error, "error");
}
// Connection starter
bot.login(ConfigFile.discord.email, ConfigFile.discord.password).then(init).catch(err);
