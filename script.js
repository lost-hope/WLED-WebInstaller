function setManifest() {
    var sel = document.getElementById('ver');
    var opt = sel.options[sel.selectedIndex];
    var m = opt.dataset.manifest;
    var me = opt.dataset.ethernet;
    var ma = opt.dataset.audio;

    // Check if ethernet manifest is available
    document.getElementById('eth').style.display = me ? "block" : "none";
    if (me && document.getElementById('ethernet').checked) {
        //disable ar version
        document.getElementById('audio').disabled = true;
        document.getElementById('ar').classList.add("disabled");
        m = me;
    } else {
        document.getElementById('audio').disabled = false;
        document.getElementById('ar').classList.remove("disabled");
    }

    //Check if audio manifest is available
    document.getElementById('ar').style.display = ma ? "block" : "none";
    if (ma && document.getElementById('audio').checked) {
        //disable ar version
        document.getElementById('ethernet').disabled = true;
        document.getElementById('eth').classList.add("disabled");
        m = ma;
    } else {
        document.getElementById('ethernet').disabled = false;
        document.getElementById('eth').classList.remove("disabled");
    }


    document.getElementById('inst').setAttribute('manifest', m);
    console.log(m);
    document.getElementById('verstr').textContent = opt.text;
}

function resetCheckboxes() {
    document.getElementById('ethernet').checked = false;
    document.getElementById('audio').checked = false;
    document.getElementById('audio').disabled = false;
    document.getElementById('ar').classList.remove("disabled");
    document.getElementById('ethernet').disabled = false;
    document.getElementById('eth').classList.remove("disabled");

}

function checkSupported() {
    if (document.getElementById('inst').hasAttribute('install-unsupported')) unsupported();
    else setManifest();
}

function unsupported() {
    document.getElementById('flasher').innerHTML = `Sorry, your browser is not yet supported!<br>
    Please try on Desktop Chrome or Edge.<br>
    Find binary files here:<br>
    <a href="https://github.com/Aircoookie/WLED/releases" target="_blank">
    <button class="btn" slot="activate">GitHub Releases</button>
    </a>`
}

function showSerialHelp() {
    document.getElementById('coms').innerHTML = `Hit "Install" and select the correct COM port.<br><br>
    You might be missing the drivers for your board.<br>
    Here are drivers for chips commonly used in ESP boards:<br>
    <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank">CP2102 (square chip)</a><br>
    <a href="https://github.com/nodemcu/nodemcu-devkit/tree/master/Drivers" target="_blank">CH34x (rectangular chip)</a><br><br>
    Make sure your USB cable supports data transfer.<br><br>
    `;
}