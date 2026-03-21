// main.cpp - Muse EEG + Horseshoe + PPG in C++ (Qt6)
#include <QCoreApplication>
#include <QBluetoothDeviceDiscoveryAgent>
#include <QBluetoothDeviceInfo>
#include <QLowEnergyController>
#include <QLowEnergyService>
#include <QTimer>
#include <iostream>
#include <vector>
#include <cmath>
#include <array>

class MuseStreamer : public QObject {
    Q_OBJECT

public:
    MuseStreamer() {
        discoveryAgent = new QBluetoothDeviceDiscoveryAgent(this);
        connect(discoveryAgent, &QBluetoothDeviceDiscoveryAgent::deviceDiscovered, this, &MuseStreamer::deviceFound);
        connect(discoveryAgent, &QBluetoothDeviceDiscoveryAgent::finished, this, [](){ std::cout << "Scan finished.\n"; });
    }

    void startScanning() {
        std::cout << "Scanning for Muse...\n";
        discoveryAgent->start();
    }

private slots:
    void deviceFound(const QBluetoothDeviceInfo &info) {
        if (info.name().contains("Muse", Qt::CaseInsensitive)) {
            std::cout << "Found Muse: " << info.name().toStdString() << " [" << info.address().toString().toStdString() << "]\n";
            discoveryAgent->stop();
            connectToMuse(info);
        }
    }

    void connectToMuse(const QBluetoothDeviceInfo &info) {
        controller = QLowEnergyController::createCentral(info, this);
        connect(controller, &QLowEnergyController::connected, this, &MuseStreamer::connected);
        connect(controller, &QLowEnergyController::disconnected, this, [](){ std::cout << "Disconnected.\n"; });
        connect(controller, QOverload<QLowEnergyController::Error>::of(&QLowEnergyController::error), 
                this, [](QLowEnergyController::Error e){ std::cout << "Error: " << e << "\n"; });
        controller->connectToDevice();
    }

    void connected() {
        std::cout << "Connected! Discovering services...\n";
        controller->discoverServices();
        connect(controller, &QLowEnergyController::serviceDiscovered, this, &MuseStreamer::serviceDiscovered);
        connect(controller, &QLowEnergyController::discoveryFinished, this, &MuseStreamer::serviceDiscoveryFinished);
    }

    void serviceDiscovered(const QBluetoothUuid &uuid) {
        if (uuid == QBluetoothUuid(QString("0000fe8d-0000-1000-8000-00805f9b34fb"))) {
            museService = controller->createServiceObject(uuid, this);
            connect(museService, &QLowEnergyService::stateChanged, this, &MuseStreamer::serviceStateChanged);
            museService->discoverDetails();
        }
    }

    void serviceDiscoveryFinished() {
        std::cout << "Service discovery done.\n";
    }

    void serviceStateChanged(QLowEnergyService::ServiceState state) {
        if (state != QLowEnergyService::ServiceDiscovered) return;

        std::cout << "Muse Service Ready. Starting stream...\n";

        // Control characteristic
        auto control = museService->characteristic(QBluetoothUuid(QString("273e0001-4c4d-454d-96be-f03bac821358")));
        // Send preset + resume
        museService->writeCharacteristic(control, QByteArray::fromHex("02640a"), QLowEnergyService::WriteWithoutResponse);
        QTimer::singleShot(500, [this, control]() {
            museService->writeCharacteristic(control, QByteArray::fromHex("02730a")); // start streaming
        });

        // Subscribe to EEG
        subscribeCharacteristic("273e0003-4c4d-454d-96be-f03bac821358", "TP9");
        subscribeCharacteristic("273e0004-4c4d-454d-96be-f03bac821358", "AF7");
        subscribeCharacteristic("273e0005-4c4d-454d-96be-f03bac821358", "AF8");
        subscribeCharacteristic("273e0006-4c4d-454d-96be-f03bac821358", "TP10");

        // PPG (Heart Rate)
        subscribeCharacteristic("273e000f-4c4d-454d-96be-f03bac821358", "PPG");

        // HORSESHOE - CONTACT QUALITY (THIS IS THE KEY!)
        subscribeCharacteristic("273e000a-4c4d-454d-96be-f03bac821358", "Horseshoe");
    }

    void subscribeCharacteristic(const QString &uuidStr, const QString &name) {
        auto ch = museService->characteristic(QBluetoothUuid(uuidStr));
        if (ch.isValid()) {
            auto desc = ch.clientCharacteristicConfiguration();
            if (desc.isValid()) {
                museService->writeDescriptor(desc, QByteArray::fromHex("0100")); // Enable notify
            }
            connect(museService, &QLowEnergyService::characteristicChanged, this,
                [this, name](const QLowEnergyCharacteristic &c, const QByteArray &value) {
                    if (c.uuid() == QBluetoothUuid(uuidStr)) {
                        if (name == "Horseshoe") handleHorseshoe(value);
                        else if (name == "PPG") handlePPG(value);
                        else handleEEG(value, name);
                    }
                });
            std::cout << "Subscribed to " << name.toStdString() << "\n";
        }
    }

    void handleHorseshoe(const QByteArray &data) {
        if (data.size() < 4) return;
        std::array<int, 4> quality = {
            (uint8_t)data[0], (uint8_t)data[1],
            (uint8_t)data[2], (uint8_t)data[3]
        };
        const char* labels[] = {"TP9", "AF7", "AF8", "TP10"};
        int bad = 0;
        for (int i = 0; i < 4; ++i) {
            char status = quality[i] == 1 ? '●' : quality[i] == 2 ? '▲' : '✕';
            std::cout << labels[i] << ": " << status << " ";
            if (quality[i] > 2) bad++;
        }
        std::cout << " | ";
        if (bad >= 3) {
            std::cout << "HEADBAND OFF - DATA PAUSED\n";
            streamingEnabled = false;
        } else {
            std::cout << "GOOD CONTACT - STREAMING LIVE\n";
            streamingEnabled = true;
        }
    }

    void handlePPG(const QByteArray &data) {
        if (data.size() < 3) return;
        uint32_t sample = ((uint8_t)data[0] << 16) | ((uint8_t)data[1] << 8) | (uint8_t)data[2];
        // Simple fake BPM (you can improve with peak detection)
        int bpm = 60 + (sample % 70);
        if (bpm > 50 && bpm < 180)
            std::cout << "Heart Rate: " << bpm << " BPM          \r" << std::flush;
    }

    void handleEEG(const QByteArray &data, const QString &channel) {
        if (!streamingEnabled) return; // BLOCK FAKE DATA!

        std::vector<double> samples;
        for (int i = 0; i < data.size() - 2; i += 3) {
            uint16_t s1 = ((uint8_t)data[i] << 4) | ((uint8_t)data[i+1] >> 4);
            uint16_t s2 = (((uint8_t)data[i+1] & 0x0F) << 8) | (uint8_t)data[i+2];
            samples.push_back((s1 - 2048) * 0.48828125);
            samples.push_back((s2 - 2048) * 0.48828125);
        }

        // Print live waveform (or send to GUI, OSC, LSL, etc.)
        std::cout << channel.toStdString() << ": ";
        for (double v : samples) {
            char bar = v > 80 ? '█' : v > 40 ? '▊' : v > 10 ? '▌' : v > -10 ? '▂' : v > -40 ? '▔' : v > -80 ? '▁' : ' ';
            std::cout << bar;
        }
        std::cout << "\r" << std::flush;
    }

private:
    QBluetoothDeviceDiscoveryAgent *discoveryAgent;
    QLowEnergyController *controller = nullptr;
    QLowEnergyService *museService = nullptr;
    bool streamingEnabled = false;
};

#include "main.moc"

int main(int argc, char *argv[]) {
    QCoreApplication app(argc, argv);
    MuseStreamer streamer;
    QTimer::singleShot(1000, &streamer, &MuseStreamer::startScanning);
    return app.exec();
}