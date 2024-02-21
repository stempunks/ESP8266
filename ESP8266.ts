//% color=#0fbc11 icon="\uf1eb"
namespace ESP8266_IoT {
    enum Cmd {
        None,
        ConnectWifi,
        ConnectThingSpeak,
        ConnectKidsIot,
        InitKidsIot,
        UploadKidsIot,
        DisconnectKidsIot,
        ConnectMqtt,
    }

    export enum KidsIotSwitchState {
        //% block="on"
        on = 1,
        //% block="off"
        off = 2
    }

    export enum SchemeList {
        //% block="TCP"
        TCP = 1,
        //% block="TLS"
        TLS = 2
    }

    export enum QosList {
        //% block="0"
        Qos0 = 0,
        //% block="1"
        Qos1,
        //% block="2"
        Qos2
    }

    let wifi_connected: boolean = false
    let thingspeak_connected: boolean = false
    let kidsiot_connected: boolean = false
    let mqttBrokerConnected: boolean = false
    let userToken_def: string = ""
    let topic_def: string = ""
    const mqttSubscribeHandlers: { [topic: string]: (message: string) => void } = {}
    const mqttSubscribeQos: { [topic: string]: number } = {}
    let mqtthost_def = "ELECFREAKS"
    let iftttkey_def = ""
    let iftttevent_def = ""
    let thingSpeakDatatemp = ""

    let serialCnt = 0
    let recvString = ""
    let scanWIFIAPFlag = 0
    let currentCmd: Cmd = Cmd.None

    const THINGSPEAK_HOST = "api.thingspeak.com"
    const THINGSPEAK_PORT = "80"
    const KIDSIOT_HOST = "139.159.161.57"
    const KIDSIOT_PORT = "5555"

    const EspEventSource = 3000
    const EspEventValue = {
        None: Cmd.None,
        ConnectWifi: Cmd.ConnectWifi,
        ConnectThingSpeak: Cmd.ConnectThingSpeak,
        ConnectKidsIot: Cmd.ConnectKidsIot,
        InitKidsIot: Cmd.InitKidsIot,
        UploadKidsIot: Cmd.UploadKidsIot,
        DisconnectKidsIot: Cmd.DisconnectKidsIot,
        ConnectMqtt: Cmd.ConnectMqtt,
        PostIFTTT: 255
    }
    const KidsIotEventSource = 3100
    const KidsIotEventValue = {
        switchOn: KidsIotSwitchState.on,
        switchOff: KidsIotSwitchState.off
    }

    let TStoSendStr = ""

    // write AT command with CR+LF ending
    function sendAT(command: string, wait: number = 0) {
        serial.writeString(`${command}\u000D\u000A`)
        basic.pause(wait)
    }

    function restEsp8266() {
        sendAT("AT+RESTORE", 1000) // restore to factory settings
        sendAT("AT+RST", 1000) // rest
        serial.readString()
        sendAT("AT+CWMODE=1", 500) // set to STA mode
        sendAT("AT+SYSTIMESTAMP=1634953609130", 100) // Set local timestamp.
        sendAT(`AT+CIPSNTPCFG=1,8,"ntp1.aliyun.com","0.pool.ntp.org","time.google.com"`, 100)
        basic.pause(3000)
    }

    function scanWIFIAP(ssid: string) {

        let scanflag = 0
        let mscnt = 0
        recvString = " "
        sendAT(`AT+CWLAPOPT=1,2,-100,255`)
        sendAT(`AT+CWLAP`)
        while (!(scanflag)) {

            recvString = recvString + serial.readString()
            basic.pause(1)
            mscnt += 1
            if(mscnt >= 3000 ){
                scanWIFIAPFlag = 0
                break
            }

            if (recvString.includes("+CWLAP:(")){

                mscnt = 0
                recvString = recvString.slice(recvString.indexOf("+CWLAP:("))
                scanflag = 1
                while(1) {

                    recvString += serial.readString()
                    basic.pause(1)
                    mscnt += 1

                    // OLED.clear()
                    // OLED.writeStringNewLine(_recvString)
                    if (recvString.includes("OK") || mscnt >= 3000) {
                        
                        if(mscnt >= 3000 ){
                            scanWIFIAPFlag = 0
                        } else if (recvString.includes(ssid)){
                            scanWIFIAPFlag = 1
                        } else {
                            scanWIFIAPFlag = 0
                        }
                        break
                    }
                }
            } 
            
        }
        recvString = " "
    }

    /**
     * Initialize ESP8266 module
     */
    //% block="set ESP8266|RX %tx|TX %rx|Baud rate %baudrate"
    //% tx.defl=SerialPin.P8
    //% rx.defl=SerialPin.P12
    //% ssid.defl=your_ssid
    //% pw.defl=your_password weight=100
    export function initWIFI(tx: SerialPin, rx: SerialPin, baudrate: BaudRate) {
        serial.redirect(tx, rx, BaudRate.BaudRate115200)
        basic.pause(100)
        serial.setTxBufferSize(128)
        serial.setRxBufferSize(128)
        restEsp8266()
    }

    /**
     * connect to Wifi router
     */
    //% block="connect Wifi SSID = %ssid|KEY = %pw"
    //% ssid.defl=your_ssid
    //% pw.defl=your_pwd weight=95
    export function connectWifi(ssid: string, pw: string) {

        while (1) {
            scanWIFIAP(ssid)
            if(scanWIFIAPFlag){
                currentCmd = Cmd.ConnectWifi
                sendAT(`AT+CWJAP="${ssid}","${pw}"`) // connect to Wifi router
                control.waitForEvent(EspEventSource, EspEventValue.ConnectWifi)
                while (!wifi_connected) {
                    restEsp8266()
                    sendAT(`AT+CWJAP="${ssid}","${pw}"`)
                    control.waitForEvent(EspEventSource, EspEventValue.ConnectWifi)
                }
                break
            } else {
                restEsp8266()
                currentCmd = Cmd.ConnectWifi
                sendAT(`AT+CWJAP="${ssid}","${pw}"`)
                control.waitForEvent(EspEventSource, EspEventValue.ConnectWifi)
                if (wifi_connected){
                    break
                }
            }
        } 
    }

    /**
     * Warning: Deprecated.
     * Check if ESP8266 successfully connected to Wifi
     */
    //% block="Wifi connected %State" weight=70
    export function wifiState(state: boolean) {
        return wifi_connected === state
    }

    /**
     * Connect to ThingSpeak
     */
    //% block="connect thingspeak"
    //% write_api_key.defl=your_write_api_key
    //% subcategory="ThingSpeak" weight=90
    export function connectThingSpeak() {
        thingspeak_connected = true
        // connect to server
        // recvString = " "
        // serialCnt = 0
        // sendAT(`AT+CIPSTART="TCP","${THINGSPEAK_HOST}",${THINGSPEAK_PORT}`)
        // currentCmd = Cmd.ConnectThingSpeak
        // basic.pause(1)
        // recvString += serial.readString()
        // if (recvString == " ") {
        //     thingspeak_connected = false
        //     //basic.showIcon(IconNames.Sad)
        // } else {
        //     control.waitForEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
            
        // } 
    }

    /**
     * Connect to ThingSpeak and set data.
     */
    //% block="set data to send ThingSpeak | Write API key = %write_api_key|Field 1 = %n1||Field 2 = %n2|Field 3 = %n3|Field 4 = %n4|Field 5 = %n5|Field 6 = %n6|Field 7 = %n7|Field 8 = %n8"
    //% write_api_key.defl=your_write_api_key
    //% expandableArgumentMode="enabled"
    //% subcategory="ThingSpeak" weight=85
    export function setData(write_api_key: string, n1: number = 0, n2: number = 0, n3: number = 0, n4: number = 0, n5: number = 0, n6: number = 0, n7: number = 0, n8: number = 0) {
        TStoSendStr = "AT+HTTPCLIENT=2,0,\"http://api.thingspeak.com/update?api_key="
            + write_api_key
            + "&field1="
            + n1
            + "&field2="
            + n2
            + "&field3="
            + n3
            + "&field4="
            + n4
            + "&field5="
            + n5
            + "&field6="
            + n6
            + "&field7="
            + n7
            + "&field8="
            + n8
            + "\",,,1"
    }

    /**
     * upload data. It would not upload anything if it failed to connect to Wifi or ThingSpeak.
     */
    //% block="Upload data to ThingSpeak"
    //% subcategory="ThingSpeak" weight=80
    export function uploadData() {
        let mscnt = 0
        //sendAT(`AT+CIPSEND=${TStoSendStr.length + 2}`, 300)
        sendAT(TStoSendStr, 100) // upload data

        while (1) {

            recvString += serial.readString()
            basic.pause(1)
            mscnt += 1

            // OLED.clear()
            // OLED.writeStringNewLine(_recvString)
            if (recvString.includes("OK") || mscnt >= 3000 || recvString.includes("ERROR")) {
                
                break
            }
        }

        recvString = " "
        basic.pause(200)
    }

    /*
     * Check if ESP8266 successfully connected to ThingSpeak
     */
    //% block="ThingSpeak connected %State"
    //% subcategory="ThingSpeak" weight=65
    export function thingSpeakState(state: boolean) {
        return thingspeak_connected === state
    } 
      
    /* ----------------------------------- kidsiot ----------------------------------- */
    /*
     * Connect to kidsiot
     */
    //% subcategory=KidsIot weight=50
    //% blockId=initkidiot block="Connect KidsIot with userToken: %userToken Topic: %topic"
    export function connectKidsiot(userToken: string, topic: string): void {
        userToken_def = userToken
        topic_def = topic
        currentCmd = Cmd.ConnectKidsIot
        sendAT(`AT+CIPSTART="TCP","${KIDSIOT_HOST}",${KIDSIOT_PORT}`)
        control.waitForEvent(EspEventSource, EspEventValue.ConnectKidsIot)
        pause(100)
        const jsonText = `{"topic":"${topic}","userToken":"${userToken}","op":"init"}`
        currentCmd = Cmd.InitKidsIot
        sendAT(`AT+CIPSEND=${jsonText.length + 2}`)
        control.waitForEvent(EspEventSource, EspEventValue.InitKidsIot)
        if (kidsiot_connected) {
            sendAT(jsonText)
            control.waitForEvent(EspEventSource, EspEventValue.InitKidsIot)
        }
        pause(1500)
    }

    /**
     * upload data to kidsiot
     */
    //% subcategory=KidsIot weight=45
    //% blockId=uploadkidsiot block="Upload data %data to kidsiot"
    export function uploadKidsiot(data: number): void {
        data = Math.floor(data)
        const jsonText = `{"topic":"${topic_def}","userToken":"${userToken_def}","op":"up","data":"${data}"}`
        currentCmd = Cmd.UploadKidsIot
        sendAT(`AT+CIPSEND=${jsonText.length + 2}`)
        control.waitForEvent(EspEventSource, EspEventValue.UploadKidsIot)
        if (kidsiot_connected) {
            sendAT(jsonText)
            control.waitForEvent(EspEventSource, EspEventValue.UploadKidsIot)
        }
        pause(1500)
    }

    /*
     * disconnect from kidsiot
     */
    //% subcategory=KidsIot weight=40
    //% blockId=Disconnect block="Disconnect with kidsiot"
    export function disconnectKidsiot(): void {
        if (kidsiot_connected) {
            const jsonText = `{"topic":"${topic_def}","userToken":"${userToken_def}","op":"close"}`
            currentCmd = Cmd.DisconnectKidsIot
            sendAT("AT+CIPSEND=" + (jsonText.length + 2))
            control.waitForEvent(EspEventSource, EspEventValue.DisconnectKidsIot)
            if (kidsiot_connected) {
                sendAT(jsonText)
                control.waitForEvent(EspEventSource, EspEventValue.DisconnectKidsIot)
            }
            pause(1500)
        }
    }

    /*
     * Check if ESP8266 successfully connected to KidsIot
     */
    //% block="KidsIot connection %State"
    //% subcategory="KidsIot" weight=35
    export function kidsiotState(state: boolean) {
        return kidsiot_connected === state
    }

    //% block="When switch %vocabulary"
    //% subcategory="KidsIot" weight=30
    //% state.fieldEditor="gridpicker" state.fieldOptions.columns=2
    export function iotSwitchEvent(state: KidsIotSwitchState, handler: () => void) {
        control.onEvent(KidsIotEventSource, state, handler)
    }

    /*----------------------------------MQTT-----------------------*/
    /*
     * Set  MQTT client
     */
    //% subcategory=MQTT weight=30
    //% blockId=initMQTT block="Set MQTT client config|scheme: %scheme clientID: %clientID username: %username password: %password path: %path"
    export function setMQTT(scheme: SchemeList, clientID: string, username: string, password: string, path: string): void {
        sendAT(`AT+MQTTUSERCFG=0,${scheme},"${clientID}","${username}","${password}",0,0,"${path}"`, 1000)
    }

    /*
     * Connect to MQTT broker
     */
    //% subcategory=MQTT weight=25
    //% blockId=connectMQTT block="connect MQTT broker host: %host port: %port reconnect: $reconnect"
    export function connectMQTT(host: string, port: number, reconnect: boolean): void {
        mqtthost_def = host
        const rec = reconnect ? 0 : 1
        currentCmd = Cmd.ConnectMqtt
        sendAT(`AT+MQTTCONN=0,"${host}",${port},${rec}`)
        control.waitForEvent(EspEventSource, EspEventValue.ConnectMqtt)
        Object.keys(mqttSubscribeQos).forEach(topic => {
            const qos = mqttSubscribeQos[topic]
            sendAT(`AT+MQTTSUB=0,"${topic}",${qos}`, 1000)
        })
    }

    /*
     * Check if ESP8266 successfully connected to mqtt broker
     */
    //% block="MQTT broker is connected"
    //% subcategory="MQTT" weight=24
    export function isMqttBrokerConnected() {
        return mqttBrokerConnected
    }

    /*
     * send message
     */
    //% subcategory=MQTT weight=21
    //% blockId=sendMQTT block="publish %msg to Topic:%topic with Qos:%qos"
    //% msg.defl=hello
    //% topic.defl=topic/1
    export function publishMqttMessage(msg: string, topic: string, qos: QosList): void {
        sendAT(`AT+MQTTPUB=0,"${topic}","${msg}",${qos},0`, 1000)
        recvString = ""
    } 
      
    /*
     * disconnect MQTT broker
     */
    //% subcategory=MQTT weight=15
    //% blockId=breakMQTT block="Disconnect from broker"
    export function breakMQTT(): void {
        sendAT("AT+MQTTCLEAN=0", 1000)
    }

    //% block="when Topic: %topic have new $message with Qos: %qos"
    //% subcategory=MQTT weight=10
    //% draggableParameters
    //% topic.defl=topic/1
    export function MqttEvent(topic: string, qos: QosList, handler: (message: string) => void) {
        mqttSubscribeHandlers[topic] = handler
        mqttSubscribeQos[topic] = qos
    }

    ////////// ----------------------------------- IFTTT ----------------------------------- //////////
    /*
     * set ifttt
     */
    //% subcategory=IFTTT weight=9
    //% blockId=setIFTTT block="set IFTTT key:%key event:%event"
    export function setIFTTT(key: string, event: string): void {
        iftttkey_def = key
        iftttevent_def = event
    } 

    /*
     * post ifttt
     */
    //% subcategory=IFTTT weight=8
    //% blockId=postIFTTT block="post IFTTT with|value1:%value value2:%value2 value3:%value3"
    export function postIFTTT(value1: string, value2: string, value3: string): void {
        let sendST1 = "AT+HTTPCLIENT=3,1,\"http://maker.ifttt.com/trigger/" + iftttevent_def + "/with/key/" + iftttkey_def + "\",,,2,"
        let sendST2 = "\"{\\\"value1\\\":\\\"" + value1 + "\\\"\\\,\\\"value2\\\":\\\"" + value2 + "\\\"\\\,\\\"value3\\\":\\\"" + value3 + "\\\"}\""
        let sendST = sendST1 + sendST2
        sendAT(sendST, 1000)
        //control.waitForEvent(EspEventSource, EspEventValue.PostIFTTT)
    }

    /*
     * on serial received data
     */
    serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function() {
        recvString += serial.readString()
        pause(1)
        serialCnt += 1

        // received kids iot data
        if (recvString.includes("switchoff")) {
            recvString = ""
            control.raiseEvent(KidsIotEventSource, KidsIotEventValue.switchOff)
        } else if (recvString.includes("switchon")) {
            recvString = ""
            control.raiseEvent(KidsIotEventSource, KidsIotEventValue.switchOn)
        }

        if (recvString.includes("MQTTSUBRECV")) {
            recvString = recvString.slice(recvString.indexOf("MQTTSUBRECV"))
            const recvStringSplit = recvString.split(",", 4)
            const topic = recvStringSplit[1].slice(1, -1)
            const message = recvStringSplit[3].slice(0, -2)
            mqttSubscribeHandlers[topic] && mqttSubscribeHandlers[topic](message)
            recvString = ""
        }

        if (recvString.includes("Congratu")) {
            recvString = ""
            control.raiseEvent(EspEventSource, EspEventValue.PostIFTTT)
        }

        switch (currentCmd) {
            case Cmd.ConnectWifi:
                if (recvString.includes("AT+CWJAP")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CWJAP"))
                    if (recvString.includes("WIFI GOT IP")) {
                        wifi_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectWifi)
                    } else if (recvString.includes("ERROR")) {
                        wifi_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectWifi)
                    } 
                }
                break
            case Cmd.ConnectThingSpeak:
                if (recvString.includes(THINGSPEAK_HOST)) {
                    recvString = recvString.slice(recvString.indexOf(THINGSPEAK_HOST))
                    if (recvString.includes("CONNECT")) {
                        thingspeak_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
                    } else if (recvString.includes("ERROR")) {
                        thingspeak_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
                    } 
                } else if (recvString.includes("WIFI GOT IP")) {
                    thingspeak_connected = false
                    recvString = ""
                    control.raiseEvent(EspEventSource, EspEventValue.ConnectThingSpeak)
                } 
                break
            case Cmd.ConnectKidsIot:
                if (recvString.includes(KIDSIOT_HOST)) {
                    recvString = recvString.slice(recvString.indexOf(KIDSIOT_HOST))
                    if (recvString.includes("CONNECT")) {
                        kidsiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectKidsIot)
                    }
                }
                break
            case Cmd.InitKidsIot:
                if (recvString.includes("AT+CIPSEND")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CIPSEND"))
                    if (recvString.includes("OK")) {
                        kidsiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitKidsIot)
                    }
                } else {
                    if (recvString.includes("SEND OK")) {
                        kidsiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.InitKidsIot)
                    }
                }
                break
            case Cmd.UploadKidsIot:
                if (recvString.includes("AT+CIPSEND")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CIPSEND"))
                    if (recvString.includes("OK")) {
                        kidsiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadKidsIot)
                    }
                } else {
                    if (recvString.includes("SEND OK")) {
                        kidsiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.UploadKidsIot)
                    }
                }
                break
            case Cmd.DisconnectKidsIot:
                if (recvString.includes("AT+CIPSEND")) {
                    recvString = recvString.slice(recvString.indexOf("AT+CIPSEND"))
                    if (recvString.includes("OK")) {
                        kidsiot_connected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectKidsIot)
                    }
                } else {
                    if (recvString.includes("SEND OK")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectKidsIot)
                    } else if (recvString.includes("ERROR")) {
                        kidsiot_connected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.DisconnectKidsIot)
                    }
                }
                break
            case Cmd.ConnectMqtt:
                if (recvString.includes(mqtthost_def)) {
                    recvString = recvString.slice(recvString.indexOf(mqtthost_def))
                    if (recvString.includes("OK")) {
                        mqttBrokerConnected = true
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectMqtt)
                    } else if (recvString.includes("ERROR")) {
                        mqttBrokerConnected = false
                        recvString = ""
                        control.raiseEvent(EspEventSource, EspEventValue.ConnectMqtt)
                    }
                }
                break
        }
    })
}
