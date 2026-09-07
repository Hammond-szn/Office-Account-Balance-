#include <iostream>
#include <iomanip>
#include <locale>

using namespace std;

// This custom facet forces C++ to inject commas as thousands separators manually
struct comma_separator : public numpunct<char> {
    protected:
        char do_thousands_sep() const override { return ','; } // Use comma for thousands
        string do_grouping() const override { return "\3"; }    // Group by 3 digits
        char do_decimal_point() const override { return '.'; } // Use dot for decimals
};

int main() {
    // Create a native locale and manually inject our comma rules into it
    locale custom_locale(locale::classic(), new comma_separator);

    // Safely inject the custom rules into input and output
    cin.imbue(custom_locale);
    cout.imbue(custom_locale);

    double TOTAL_GROSS, TOTAL_WIN;

    // You can safely type numbers with commas here (e.g., 10,000.50)
    cout << "ENTER TOTAL GROSS: ";
    cin >> TOTAL_GROSS;

    // Net = gross minus 35% of gross
    double NET = TOTAL_GROSS - (TOTAL_GROSS * 0.35);

    cout << fixed << setprecision(0);
    cout << "TOTAL NET: " << NET << endl; // Prints with formatting commas

    // You can type numbers with commas here too
    cout << "ENTER TOTAL WIN: ";
    cin >> TOTAL_WIN;

    double WIN = TOTAL_WIN * 240;
    cout << "TOTAL WIN: " << WIN << endl; // Prints with formatting commas

    if (NET > WIN) {
        cout << "BTO : " << NET - WIN << endl;
    } else {
        cout << "BTA : " << WIN - NET << endl;
    }
    cout << "\n====================================\n";
    cout << "          ACCOUNT SUMMARY           \n";
    cout << "====================================\n";
    
    cout << "TOTAL GROSS      : " << TOTAL_GROSS << endl;
    cout << "TOTAL NET        : " << NET << endl;
    cout << "TOTAL WINS: " << TOTAL_WIN << endl;
    cout << "WINS NET          : " << WIN << endl;
    
    cout << "------------------------------------\n";
    double BTO = (NET > WIN) ? (NET - WIN) : 0;
    double BTA = (WIN > NET) ? (WIN - NET) : 0;

    if (NET > WIN) {
        cout << "BTO              : " << NET - WIN << endl;
    } else {
        cout << "BTA              : " << WIN - NET << endl;
    }
    if (BTA > 0)
    return 0;
    else if (BTO > 0)
    cout << "====================================\n";
     cout << "WELCOME TO CASH BALANCE section" << endl;
    double cash_balance;
  
    cout << "Enter your cash at hand: ";
    cin >> cash_balance;
    
    if (cash_balance < BTO) {
        cout << " SHORTAGE: " << BTO - cash_balance << endl;
     
    }
    else if (cash_balance > BTO) {
        cout << " EXCESS: " << cash_balance - BTO << endl;
    }
     else if (cash_balance = BTO) {
        
    cout << " GOOD JOB "  << endl;
    }


    return 0;
}
