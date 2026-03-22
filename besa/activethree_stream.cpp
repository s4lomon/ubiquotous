/*
 * activethree_stream.cpp  — v2  (with event injection)
 * ======================================================
 * Authentic BioSemi binary stream + UDP event server on port 9999.
 *
 * EVENT PROTOCOL (UDP plaintext to 127.0.0.1:9999):
 *   "ARM_RIGHT"   → motor imagery right arm (ERD left hemisphere, EMG burst)
 *   "ARM_LEFT"    → motor imagery left arm  (ERD right hemisphere, EMG burst)
 *   "BLINK_RIGHT" → right eye blink (large EOG corneoretinal potential)
 *   "BLINK_LEFT"  → left eye blink
 *   "STARTLE"     → startle/alert (N100 + P300 + broadband burst)
 *
 * BUILD:
 *   g++ -O2 -std=c++17 -o activethree_stream activethree_stream.cpp -lm -lpthread
 * RUN:
 *   ./activethree_stream | ./activethree_reader
 */

#include <cstdint>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>
#include <chrono>
#include <thread>
#include <atomic>
#include <vector>
#include <csignal>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <fcntl.h>

static constexpr int    N_CH        = 144;
static constexpr int    N_EEG       = 128;
static constexpr double SAMPLE_RATE = 16384.0;
static constexpr double DT          = 1.0 / SAMPLE_RATE;
static constexpr double LSB         = 31.25e-9;
static constexpr uint32_t CMS_OK    = (1u << 16);
static constexpr int    UDP_PORT    = 9999;

enum EventCode : uint8_t { EVT_NONE=0, EVT_ARM_R=1, EVT_ARM_L=2, EVT_BLINK_R=3, EVT_BLINK_L=4, EVT_STARTLE=5 };

struct { std::atomic<EventCode> code{EVT_NONE}; std::atomic<int> rem{0}; } g_evt;
static volatile bool g_run = true;
static void on_sig(int) { g_run = false; }

// ── Pink noise ────────────────────────────────────────────────────────────────
struct Pink {
    std::mt19937_64 rng; std::normal_distribution<double> nd{0,1};
    double rows[5]{}; double sum{}; int ctr{};
    explicit Pink(uint64_t s) : rng(s) {}
    double next(double amp) {
        int lb=ctr&-ctr; ctr++;
        for(int i=0;i<5;++i) if(lb&(1<<i)){sum-=rows[i];rows[i]=nd(rng);sum+=rows[i];}
        return (sum/5.0)*amp;
    }
};

static inline int32_t enc(double v) {
    double c=v/LSB; if(c>8388607)c=8388607; if(c<-8388608)c=-8388608;
    return (int32_t)c<<8;
}

enum Reg { OCC,FRONT,CENT,TEMP,PAR,OTHER };
static Reg reg(int ch) {
    if(ch>=24&&ch<=30) return OCC;
    if(ch<=7||(ch>=33&&ch<=41)) return FRONT;
    if(ch>=11&&ch<=16) return CENT;
    if(ch>=14&&ch<=17) return TEMP;
    if(ch>=18&&ch<=23) return PAR;
    return OTHER;
}

static double eeg_base(int ch, double t, Pink& pk, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0,1);
    double s=pk.next(4e-6)+wn(rng)*200e-9;
    switch(reg(ch)) {
        case OCC:  s+=30e-6*sin(2*M_PI*10*t+.3)+10e-6*sin(2*M_PI*9.5*t+1.1)+5e-6*sin(2*M_PI*11*t+.7); break;
        case FRONT:s+=12e-6*sin(2*M_PI*20*t+.5)+8e-6*sin(2*M_PI*18*t+1.3); break;
        case CENT: s+=15e-6*sin(2*M_PI*6*t+.9)+10e-6*sin(2*M_PI*11*t+2); break;
        case TEMP: s+=8e-6*sin(2*M_PI*7*t+1.5); break;
        case PAR:  s+=8e-6*sin(2*M_PI*10*t+.2); break;
        default:   break;
    }
    s+=50e-9*sin(2*M_PI*50*t);
    double ep=fmod(t,1.0); if(ep<0.01) s+=1.5e-6*exp(-ep/0.003);
    return s;
}

// ── Event overlays ────────────────────────────────────────────────────────────
static double evt_arm(int ch, double p, bool right_arm, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0,1);
    // Contralateral hemisphere suppresses alpha/beta (ERD), then gamma burst
    bool contra = right_arm ? (ch>=8&&ch<=20) : (ch>=44&&ch<=56);
    if(!contra) return 0;
    double s = -20e-6*sin(2*M_PI*10*p*2)   // alpha ERD
              + 8e-6*sin(2*M_PI*40*p*.5+1)  // gamma burst
              + wn(rng)*6e-6;               // motor broadband
    return s;
}

static double evt_blink(int ch, double p, bool right) {
    bool strong = right ? (ch>=33&&ch<=40) : (ch>=0&&ch<=7);
    bool mid    = (ch==32);
    double amp  = (strong||mid) ? 250e-6 : 30e-6;
    return amp * sin(M_PI*p);  // bell shape
}

static double evt_startle(int ch, double p, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0,1);
    double s = wn(rng)*15e-6;
    // N100: early negative frontal ~100ms
    if(p<0.15 && reg(ch)==FRONT)  s -= 40e-6*sin(M_PI*p/0.15);
    // P300: positive parieto-central ~300ms
    if(p>0.25&&p<0.55&&(reg(ch)==PAR||reg(ch)==CENT))
        s += 60e-6*sin(M_PI*(p-0.25)/0.30);
    // Late slow wave
    if(p>0.5) s += 20e-6*sin(M_PI*(p-0.5)/0.5);
    return s;
}

static double exg_sig(int ch, double t, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0,1);
    double s=wn(rng)*300e-9;
    switch(ch) {
        case 0:case 1:{double bp=fmod(t,1.0);
            if(bp<.005)s+=.5e-3;else if(bp<.025)s+=1.5e-3;
            else if(bp<.030)s-=.8e-3;else if(bp<.035)s+=1.8e-3;
            else if(bp<.200)s+=.3e-3; break;}
        case 2:case 3:s+=wn(rng)*15e-6+10e-6*sin(2*M_PI*50*t);break;
        case 4:s+=80e-6*sin(2*M_PI*.5*t);break;
        case 5:s+=50e-6*sin(2*M_PI*.2*t);break;
        default:s+=wn(rng)*1e-6;
    }
    return s;
}

static double sensor_sig(int ch, double t) {
    switch(ch){
        case 0:return .8*sin(2*M_PI*.25*t);
        case 1:return .2+.05*sin(2*M_PI*.05*t);
        default:return fmod(t,5.0)<.05?1.0:0.0;
    }
}

// ── UDP thread ────────────────────────────────────────────────────────────────
static void udp_listen() {
    int sock=socket(AF_INET,SOCK_DGRAM,0);
    if(sock<0){fprintf(stderr,"[stream] UDP socket error\n");return;}
    fcntl(sock,F_SETFL,O_NONBLOCK);
    sockaddr_in a{}; a.sin_family=AF_INET; a.sin_addr.s_addr=INADDR_ANY; a.sin_port=htons(UDP_PORT);
    bind(sock,(sockaddr*)&a,sizeof(a));
    fprintf(stderr,"[stream] Ready — UDP event server on 127.0.0.1:%d\n",UDP_PORT);

    char buf[64];
    while(g_run){
        ssize_t n=recv(sock,buf,sizeof(buf)-1,0);
        if(n>0){
            buf[n]='\0';
            for(int i=0;i<n;++i) if(buf[i]=='\n'||buf[i]=='\r') buf[i]='\0';
            EventCode code=EVT_NONE; int dur=0;
            if     (!strcmp(buf,"ARM_RIGHT"))  {code=EVT_ARM_R;   dur=(int)(1.5*SAMPLE_RATE);}
            else if(!strcmp(buf,"ARM_LEFT"))   {code=EVT_ARM_L;   dur=(int)(1.5*SAMPLE_RATE);}
            else if(!strcmp(buf,"BLINK_RIGHT")){code=EVT_BLINK_R; dur=(int)(.3*SAMPLE_RATE);}
            else if(!strcmp(buf,"BLINK_LEFT")) {code=EVT_BLINK_L; dur=(int)(.3*SAMPLE_RATE);}
            else if(!strcmp(buf,"STARTLE"))    {code=EVT_STARTLE;  dur=(int)(.8*SAMPLE_RATE);}
            if(code!=EVT_NONE){g_evt.code.store(code);g_evt.rem.store(dur);
                fprintf(stderr,"[stream] EVENT → %s (%d samples / %.2fs)\n",buf,dur,(double)dur/SAMPLE_RATE);}
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    close(sock);
}

// ── Main ─────────────────────────────────────────────────────────────────────
int main(){
    signal(SIGINT,on_sig);
    std::mt19937_64 rng(std::chrono::steady_clock::now().time_since_epoch().count());
    std::vector<Pink> pk; pk.reserve(N_EEG);
    for(int i=0;i<N_EEG;++i) pk.emplace_back((uint64_t)i*123456+1);

    std::thread(udp_listen).detach();

    using clk=std::chrono::steady_clock; using ns=std::chrono::nanoseconds;
    const ns period=ns((long long)(1e9/SAMPLE_RATE));
    setvbuf(stdout,nullptr,_IOFBF,N_CH*sizeof(int32_t)*256);

    int32_t frame[N_CH]; uint64_t sample=0; auto tick=clk::now();

    while(g_run){
        double t=sample*DT;
        EventCode cur=g_evt.code.load(); int rem=g_evt.rem.load();
        double phase=0; int total=0;

        if(cur!=EVT_NONE&&rem>0){
            switch(cur){
                case EVT_ARM_R:case EVT_ARM_L: total=(int)(1.5*SAMPLE_RATE);break;
                case EVT_BLINK_R:case EVT_BLINK_L:total=(int)(.3*SAMPLE_RATE);break;
                case EVT_STARTLE:total=(int)(.8*SAMPLE_RATE);break;
                default:total=1;
            }
            phase=1.0-(double)rem/total;
            int newrem=rem-1; g_evt.rem.store(newrem);
            if(newrem==0) g_evt.code.store(EVT_NONE);
        } else { cur=EVT_NONE; }

        frame[0]=(int32_t)(CMS_OK|(uint32_t)cur);

        for(int ch=0;ch<N_EEG;++ch){
            double s=eeg_base(ch,t,pk[ch],rng);
            switch(cur){
                case EVT_ARM_R:   s+=evt_arm(ch,phase,true,rng);break;
                case EVT_ARM_L:   s+=evt_arm(ch,phase,false,rng);break;
                case EVT_BLINK_R: s+=evt_blink(ch,phase,true);break;
                case EVT_BLINK_L: s+=evt_blink(ch,phase,false);break;
                case EVT_STARTLE: s+=evt_startle(ch,phase,rng);break;
                default:break;
            }
            frame[1+ch]=enc(s);
        }

        for(int ch=0;ch<8;++ch){
            double s=exg_sig(ch,t,rng);
            if((cur==EVT_ARM_R&&ch==2)||(cur==EVT_ARM_L&&ch==3)){
                std::normal_distribution<double> wn(0,1);
                s+=wn(rng)*80e-6*sin(M_PI*phase); // EMG burst
            }
            frame[129+ch]=enc(s);
        }
        for(int ch=0;ch<6;++ch) frame[137+ch]=enc(sensor_sig(ch,t));
        frame[143]=0;

        fwrite(frame,sizeof(int32_t),N_CH,stdout);
        ++sample; tick+=period;
        std::this_thread::sleep_until(tick);
    }
    fflush(stdout); return 0;
}
